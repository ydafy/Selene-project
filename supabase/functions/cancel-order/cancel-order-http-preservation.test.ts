import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ApiError,
  parseCancelOrderRequestBody,
  resolveManualShipmentCancelPlan,
} from './cancel-order';
import { runShipmentCancellation } from '../_shared/shipment-cancellation';
import { createCancellationReporter } from '../_shared/cancellation-alerts';
import { buildStripeFeeReconciliationPlan } from '../stripe-webhooks/single-modal-settlement';

// Run the full serve callback with real domain helpers and no remote SDK imports.
async function invoke(
  options: {
    busy?: boolean;
    providerError?: string;
    refundStatus?: string;
    recordError?: string;
    claimError?: string;
    startError?: string;
    /** Claim answers `recovery_required` and the recovery read returns this operation. */
    recovery?: {
      refundId?: string;
      refundStatus?: string;
      escalated?: boolean;
      hoursSinceStart?: number;
    };
    recoveryError?: string;
    listError?: string;
    retrieveError?: string;
    escalateResult?: unknown;
    escalateError?: string;
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
  const escalations: unknown[] = [];
  const reports: { message: string; options: unknown }[] = [];
  const stripeLookups: string[] = [];
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
      if (name === 'fn_claim_shipment_cancellation' && options.claimError)
        return { error: { message: options.claimError } };
      if (
        name === 'fn_start_shipment_cancellation_refund' &&
        options.startError
      )
        return { error: { message: options.startError } };
      if (name === 'fn_get_shipment_cancellation_recovery') {
        if (options.recoveryError)
          return { error: { message: options.recoveryError } };
        const recovery = options.recovery ?? {};
        return {
          data: {
            operation_key: 'cancel_shipment_target',
            order_id: 'order',
            source: 'buyer',
            actor_id: 'buyer',
            reason: 'Stored reason',
            refund_request: {
              payment_intent: 'pi_target',
              amount: 11000,
              reason: 'requested_by_customer',
              metadata: {
                shipment_id: 'target',
                order_id: 'order',
                caller_role: 'buyer',
                reason: 'Stored reason',
                seguro_share_cents: 1000,
              },
            },
            cancellation_loss_cents: 500,
            refund_id: recovery.refundId ?? null,
            refund_status: recovery.refundStatus ?? null,
            external_started_at: new Date(
              Date.now() - (recovery.hoursSinceStart ?? 1) * 60 * 60 * 1000,
            ).toISOString(),
            recovery_escalated_at: recovery.escalated
              ? new Date().toISOString()
              : null,
          },
        };
      }
      if (name === 'fn_escalate_shipment_cancellation') {
        escalations.push(args);
        if (options.escalateError)
          return { error: { message: options.escalateError } };
        return { data: options.escalateResult ?? { escalated: true } };
      }
      if (name === 'fn_claim_shipment_cancellation')
        return {
          data: options.recovery
            ? { status: 'recovery_required' }
            : options.busy
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
      list: () => ({
        autoPagingToArray: async () => {
          stripeLookups.push('list');
          if (options.listError) throw new Error(options.listError);
          return [];
        },
      }),
      retrieve: async () => {
        stripeLookups.push('retrieve');
        throw new Error(options.retrieveError ?? 'unexpected retrieve');
      },
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
    'createCancellationReporter',
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
    (name: string, log: Parameters<typeof createCancellationReporter>[1]) =>
      createCancellationReporter(name, log, async (message, reportOptions) => {
        reports.push({ message, options: reportOptions });
      }),
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
    escalations,
    reports,
    stripeLookups,
    logs,
    before,
    after: hash(),
  };
}

describe('manual cancellation HTTP preservation', () => {
  test('generic provider failure preserves HTTP 500, exact message and logging without completion', async () => {
    const result = await invoke({ providerError: 'provider unavailable' });
    expect(result.response.status).toBe(500);
    expect(result.body).toBe('{"error":"CANCELLATION_REFUND_PROVIDER_FAILED"}');
    expect(result.body).not.toContain('provider unavailable');
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
        error: 'CANCELLATION_REFUND_PROVIDER_FAILED',
      }),
    ]);
  });
  test('a claim RPC error returns a stable 409 and keeps the RPC text in the logs only', async () => {
    const result = await invoke({ claimError: 'claim secret detail p_actor_id' });
    expect(result.response.status).toBe(409);
    expect(result.body).toBe('{"error":"CANCELLATION_CLAIM_FAILED"}');
    expect(result.body).not.toContain('claim secret detail');
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'ERROR',
        error: 'claim secret detail p_actor_id',
      }),
    );
    expect(result.refunds).toEqual([]);
    expect(result.completions).toEqual([]);
    expect(result.after).toBe(result.before);
  });
  test('a start RPC error returns a stable 409 and keeps the RPC text in the logs only', async () => {
    const result = await invoke({ startError: 'start secret detail p_claim_token' });
    expect(result.response.status).toBe(409);
    expect(result.body).toBe('{"error":"CANCELLATION_START_FAILED"}');
    expect(result.body).not.toContain('start secret detail');
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'ERROR',
        error: 'start secret detail p_claim_token',
      }),
    );
    expect(result.refunds).toEqual([]);
    expect(result.completions).toEqual([]);
    expect(result.after).toBe(result.before);
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
          ? '{"error":"CANCELLATION_REFUND_PROVIDER_FAILED"}'
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
  describe('recovery errors (B2.2.1)', () => {
    test('an unreadable recovery operation returns CANCELLATION_RECOVERY_UNAVAILABLE and leaks no RPC text', async () => {
      const result = await invoke({
        recovery: {},
        recoveryError: 'recovery secret detail',
      });
      expect(result.response.status).toBe(500);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_UNAVAILABLE"}');
      expect(result.body).not.toContain('recovery secret detail');
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: 'Cancellation recovery lookup failed',
          error: 'recovery secret detail',
        }),
      );
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
      expect(result.after).toBe(result.before);
    });
    test.each([
      ['list', { recovery: {}, listError: 'stripe list secret' }, 'stripe list secret'],
      [
        'retrieve',
        {
          recovery: { refundId: 're_target', refundStatus: 'pending' },
          retrieveError: 'stripe retrieve secret',
        },
        'stripe retrieve secret',
      ],
    ])('a Stripe %s failure returns CANCELLATION_REFUND_LOOKUP_FAILED and leaks no Stripe text', async (action, options, raw) => {
      const result = await invoke(options);
      expect(result.response.status).toBe(500);
      expect(result.body).toBe('{"error":"CANCELLATION_REFUND_LOOKUP_FAILED"}');
      expect(result.body).not.toContain(raw);
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: 'Stripe refund lookup failed',
          action,
          error: raw,
        }),
      );
      expect(result.stripeLookups).toEqual([action]);
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
      expect(result.after).toBe(result.before);
    });
    test('a Stripe error during a recovery replay returns CANCELLATION_REFUND_PROVIDER_FAILED', async () => {
      const result = await invoke({
        recovery: {},
        providerError: 'replay provider secret',
      });
      expect(result.response.status).toBe(500);
      expect(result.body).toBe('{"error":"CANCELLATION_REFUND_PROVIDER_FAILED"}');
      expect(result.body).not.toContain('replay provider secret');
      expect(result.refunds).toHaveLength(1);
      expect((result.refunds[0] as unknown[])[1]).toEqual({
        idempotencyKey: 'cancel_shipment_target',
      });
      expect(result.completions).toEqual([]);
    });
  });
  describe('escalation (B2.2.1)', () => {
    test('a refund missing after 24 h escalates once, alerts, and creates nothing', async () => {
      const result = await invoke({ recovery: { hoursSinceStart: 24 } });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
      expect(result.escalations).toEqual([
        { p_shipment_id: 'target', p_reason: 'refund_not_found' },
      ]);
      expect(result.reports).toEqual([
        expect.objectContaining({
          message: 'cancel-order CANCELLATION_REFUND_NOT_FOUND',
        }),
      ]);
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
      expect(result.after).toBe(result.before);
    });
    test('a repeated escalation (already recorded) does not alert again', async () => {
      const result = await invoke({
        recovery: { hoursSinceStart: 24 },
        escalateResult: { escalated: false },
      });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
      expect(result.escalations).toHaveLength(1);
      expect(result.reports).toEqual([]);
      expect(result.logs.filter((entry) => entry.level === 'CRITICAL')).toEqual([]);
    });
    test('an escalated operation stops before any Stripe call, escalation or alert', async () => {
      const result = await invoke({
        recovery: { hoursSinceStart: 48, escalated: true },
      });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
      expect(result.stripeLookups).toEqual([]);
      expect(result.escalations).toEqual([]);
      expect(result.reports).toEqual([]);
      expect(result.refunds).toEqual([]);
    });
    test('an escalation RPC error still needs an admin, still alerts, and leaks no RPC text', async () => {
      const result = await invoke({
        recovery: { hoursSinceStart: 24 },
        escalateError: 'escalate secret detail',
      });
      expect(result.response.status).toBe(409);
      expect(result.body).toBe('{"error":"CANCELLATION_RECOVERY_REQUIRED"}');
      expect(result.body).not.toContain('escalate secret detail');
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: 'Cancellation escalation failed',
          error: 'escalate secret detail',
        }),
      );
      expect(result.reports).toHaveLength(1);
      expect(result.refunds).toEqual([]);
    });
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
