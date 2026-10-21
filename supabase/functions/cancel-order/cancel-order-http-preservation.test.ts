import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ApiError,
  parseCancelOrderRequestBody,
  resolveManualShipmentCancelPlan,
} from './cancel-order';
import { runShipmentCancellation } from '../_shared/shipment-cancellation';
import { buildStripeFeeReconciliationPlan } from '../stripe-webhooks/single-modal-settlement';

// Run the full serve callback with real domain helpers and no remote SDK imports.
async function invoke(
  options: {
    busy?: boolean;
    providerError?: string;
    refundStatus?: string;
    recordError?: string;
  } = {},
) {
  const business = {
    order: {
      buyer_id: 'buyer',
      total_amount: 110,
      actual_stripe_fee_cents: 500,
      stripe_charge_id: null,
    },
    shipment: {
      id: 'target',
      order_id: 'order',
      seller_id: 'seller',
      status: 'paid',
      stripe_payment_intent_id: 'pi_target',
      stripe_transfer_id: null,
    },
    items: [
      { shipment_id: 'target', price_at_purchase: 100, shipping_amount: 900 },
    ],
    products: [{ id: 'product', status: 'SOLD', reserved: true }],
    notifications: [],
  };
  const hash = () =>
    createHash('sha256').update(JSON.stringify(business)).digest('hex');
  const before = hash();
  const events: string[] = [];
  const refunds: unknown[][] = [];
  const completions: unknown[] = [];
  const recordings: unknown[] = [];
  const logs: Record<string, unknown>[] = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'buyer' } } }) },
    from(table: string) {
      events.push(table);
      const data =
        table === 'system_settings'
          ? { is_maintenance: false }
          : table === 'orders'
            ? business.order
            : table === 'shipments'
              ? business.shipment
              : table === 'order_items'
                ? business.items
                : undefined;
      if (!data) throw new Error(`Unexpected table: ${table}`);
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: structuredClone(data) }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(resolve({ data: structuredClone(data) })),
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      events.push(name);
      if (name === 'fn_claim_shipment_cancellation')
        return {
          data: options.busy
            ? { status: 'busy' }
            : {
                status: 'claimed',
                source: 'buyer',
                actor_id: 'buyer',
                reason: 'Current reason',
                operation_key: 'cancel_shipment_target',
                claim_token: 'token',
              },
        };
      if (name === 'fn_start_shipment_cancellation_refund')
        return {
          data: {
            operation_key: 'cancel_shipment_target',
            refund_request: structuredClone(args.p_refund_request),
            cancellation_loss_cents: args.p_cancellation_loss_cents,
          },
        };
      if (name === 'fn_record_shipment_cancellation_refund') {
        recordings.push(args);
        if (options.recordError)
          return { error: { message: options.recordError } };
        return {
          data: {
            refund_id: args.p_refund_id,
            refund_status: args.p_status,
            refund_failure_reason: args.p_failure_reason,
            changed: true,
          },
        };
      }
      if (name === 'fn_cancel_shipment') {
        completions.push(args);
        return { data: [{ success: true }] };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  class FakeStripe {
    static createFetchHttpClient() {
      return {};
    }
    refunds = {
      create: async (...args: unknown[]) => {
        refunds.push(args);
        if (options.providerError) throw new Error(options.providerError);
        return {
          id: 're_target',
          payment_intent: 'pi_target',
          amount: 11000,
          status: options.refundStatus ?? 'succeeded',
          failure_reason: null,
        };
      },
    };
  }
  let handler!: (request: Request) => Promise<Response>;
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const executable = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, ''),
  );
  new Function(
    'serve',
    'createClient',
    'Stripe',
    'Deno',
    'console',
    'ApiError',
    'parseCancelOrderRequestBody',
    'resolveManualShipmentCancelPlan',
    'runShipmentCancellation',
    'buildStripeFeeReconciliationPlan',
    'withSentry',
    'reportMessage',
    executable,
  )(
    (callback: typeof handler) => {
      handler = callback;
    },
    () => supabase,
    FakeStripe,
    { env: { get: () => 'fake' } },
    { log: (value: string) => logs.push(JSON.parse(value)) },
    ApiError,
    parseCancelOrderRequestBody,
    resolveManualShipmentCancelPlan,
    runShipmentCancellation,
    buildStripeFeeReconciliationPlan,
    (_name: string, callback: typeof handler) => callback,
    async () => undefined,
  );
  const response = await handler(
    new Request('https://test.invalid/cancel-order', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fake',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId: 'order',
        shipmentId: 'target',
        reason: 'Current reason',
      }),
    }),
  );
  return {
    response,
    body: await response.text(),
    events,
    refunds,
    completions,
    recordings,
    logs,
    before,
    after: hash(),
  };
}

describe('manual cancellation HTTP preservation', () => {
  test('generic provider failure preserves HTTP 500, exact message and logging without completion', async () => {
    const result = await invoke({ providerError: 'provider unavailable' });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe(
      '{"error":"Error de Stripe: provider unavailable"}',
    );
    expect(result.refunds).toEqual([
      [
        {
          payment_intent: 'pi_target',
          amount: 11000,
          reason: 'requested_by_customer',
          metadata: {
            shipment_id: 'target',
            order_id: 'order',
            caller_role: 'buyer',
            reason: 'Current reason',
            seguro_share_cents: 1000,
          },
        },
        { idempotencyKey: 'cancel_shipment_target' },
      ],
    ]);
    expect(result.events).toContain('fn_start_shipment_cancellation_refund');
    expect(result.completions).toEqual([]);
    expect(result.after).toBe(result.before);
    expect(result.logs).toEqual([
      expect.objectContaining({
        level: 'ERROR',
        msg: 'Stripe refund failed',
        shipmentId: 'target',
        error: 'provider unavailable',
      }),
      expect.objectContaining({
        level: 'ERROR',
        msg: 'Fallo en proceso de cancelación',
        error: 'Error de Stripe: provider unavailable',
      }),
    ]);
  });
  test('busy returns exact 409 without reconstruction, provider or business effects', async () => {
    const result = await invoke({ busy: true });
    expect(result.response.status).toBe(409);
    expect(result.body).toBe('{"error":"CANCELLATION_BUSY"}');
    expect(result.events).toEqual([
      'system_settings',
      'orders',
      'shipments',
      'fn_claim_shipment_cancellation',
    ]);
    expect(result.refunds).toEqual([]);
    expect(result.completions).toEqual([]);
    expect(result.after).toBe(result.before);
  });
  for (const options of [
    { providerError: 'charge_already_refunded' },
    { refundStatus: 'pending' },
  ]) {
    test(`unconfirmed provider outcome cannot complete: ${JSON.stringify(options)}`, async () => {
      const result = await invoke(options);
      expect(result.response.status).toBe(options.providerError ? 500 : 409);
      expect(result.body).toBe(
        options.providerError
          ? '{"error":"Error de Stripe: charge_already_refunded"}'
          : '{"error":"CANCELLATION_REFUND_UNCONFIRMED"}',
      );
      expect(result.refunds).toHaveLength(1);
      expect(result.recordings).toHaveLength(options.providerError ? 0 : 1);
      expect(result.completions).toEqual([]);
      expect(result.after).toBe(result.before);
    });
  }
  test('a record RPC error returns a stable 500 and never leaks the RPC text', async () => {
    const result = await invoke({ recordError: 'secret rpc detail p_refund_id' });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe('{"error":"CANCELLATION_REFUND_RECORD_FAILED"}');
    expect(result.body).not.toContain('secret rpc detail');
    expect(result.completions).toEqual([]);
    expect(result.refunds).toHaveLength(1);
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'ERROR',
        error: 'secret rpc detail p_refund_id',
      }),
    );
    expect(result.after).toBe(result.before);
  });
  test('succeeded refund retains the existing HTTP success contract', async () => {
    const result = await invoke();
    expect(result.response.status).toBe(200);
    expect(result.body).toBe(
      '{"success":true,"message":"Shipment canceled and refund processed"}',
    );
    expect(result.refunds).toHaveLength(1);
    expect(result.recordings).toEqual([
      {
        p_shipment_id: 'target',
        p_refund_id: 're_target',
        p_payment_intent_id: 'pi_target',
        p_amount_cents: 11000,
        p_status: 'succeeded',
        p_failure_reason: null,
      },
    ]);
    expect(
      result.events.indexOf('fn_record_shipment_cancellation_refund'),
    ).toBeGreaterThan(
      result.events.indexOf('fn_start_shipment_cancellation_refund'),
    );
    expect(result.events.indexOf('fn_cancel_shipment')).toBeGreaterThan(
      result.events.indexOf('fn_record_shipment_cancellation_refund'),
    );
    expect(result.completions).toEqual([
      {
        p_shipment_id: 'target',
        p_cancelled_by_role: 'buyer',
        p_reason: 'Current reason',
        p_cancellation_loss_cents: 500,
      },
    ]);
  });
});
