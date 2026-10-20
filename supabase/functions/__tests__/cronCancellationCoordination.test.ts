import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runShipmentCancellation } from '../_shared/shipment-cancellation';
import {
  allocateCancellationLossCents,
  computeShipmentRefundAmountCents,
} from '../_shared/refund-basis';
import { resolveAutoCancelShipmentCancellationGate } from '../_shared/auto-cancel-safety';

// Execute the actual per-shipment adapter, without importing serve or remote SDKs.
function adapter(name: string) {
  const source = readFileSync(
    new URL(`../${name}/index.ts`, import.meta.url),
    'utf8',
  );
  const start = source.indexOf('const result = await runShipmentCancellation(');
  expect(start).toBeGreaterThan(0);
  const end = source.indexOf('// Delay', start);
  const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `async function execute(supabaseAdmin, stripe, shipment, log, runShipmentCancellation, computeShipmentRefundAmountCents, allocateCancellationLossCents, resolveAutoCancelShipmentCancellationGate) { let successCount = 0; const hours = 80; ${source.slice(start, end)} return successCount; }`,
  );
  return new Function(`${body}; return execute;`)();
}

for (const name of ['auto-cancel-orders', 'auto-cancel-preparing']) {
  describe(name, () => {
    async function run(
      options: {
        status?: string;
        reservation?: { claimed: boolean; started: boolean };
        failStart?: boolean;
        rpcErrorAt?: string;
        missingPI?: boolean;
        shipmentPI?: string;
        invalid?: boolean;
        remaining?: number;
        refundStatus?: string;
        providerError?: boolean;
        source?: string;
        recordings?: unknown[];
      } = {},
    ) {
      const expectedSource =
        name === 'auto-cancel-orders' ? 'paid_timeout' : 'preparing_timeout';
      const events: string[] = [];
      const refunds: unknown[] = [];
      const completions: Record<string, unknown>[] = [];
      const recordings: Record<string, unknown>[] = [];
      const logs: unknown[] = [];
      const order = {
        stripe_charge_id: 'ch',
        total_amount: 7569.59,
        stripe_payment_intent_id: options.missingPI ? null : 'pi_order',
        actual_stripe_fee_cents: 31959,
      };
      const items = [
        {
          shipment_id: 'target',
          price_at_purchase: options.invalid ? 0 : 3250,
          shipping_amount: 900,
        },
        {
          shipment_id: 'sibling',
          price_at_purchase: 4000,
          shipping_amount: 900,
        },
      ];
      const supabase = {
        from(table: string) {
          events.push(table);
          const query = {
            select: () => query,
            eq: () => query,
            single: async () => ({ data: order }),
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(resolve({ data: items })),
          };
          return query;
        },
        async rpc(name: string, args: Record<string, unknown>) {
          events.push(name);
          // supabase-js returns PostgrestError as a plain object, not an Error.
          if (options.rpcErrorAt === name)
            return {
              error: {
                message: 'SHIPMENT_LABEL_OPERATION_ACTIVE',
                code: 'P0001',
                details: null,
                hint: null,
              },
            };
          if (name === 'fn_claim_shipment_cancellation') {
            if (options.reservation) {
              if (options.reservation.started)
                return { data: { status: 'recovery_required' } };
              if (options.reservation.claimed)
                return { data: { status: 'busy' } };
              options.reservation.claimed = true;
            }
            expect(args).toMatchObject({
              p_shipment_id: 'target',
              p_order_id: 'order',
              p_actor_id: null,
              p_source: expectedSource,
            });
            return {
              data: {
                status: options.status ?? 'claimed',
                operation_key: 'cancel_shipment_target',
                claim_token: 'token',
                source: options.source ?? args.p_source,
                actor_id: options.source ? 'original_actor' : null,
                reason: options.source ? 'Original reason' : args.p_reason,
              },
            };
          }
          if (name === 'fn_start_shipment_cancellation_refund') {
            if (options.reservation) options.reservation.started = true;
            return options.failStart
              ? { error: new Error('start denied') }
              : {
                  data: {
                    operation_key: 'cancel_shipment_target',
                    refund_request: args.p_refund_request,
                    cancellation_loss_cents: args.p_cancellation_loss_cents,
                  },
                };
          }
          if (name === 'fn_record_shipment_cancellation_refund') {
            recordings.push(args);
            return {
              data: {
                refund_id: args.p_refund_id,
                refund_status: args.p_status,
                refund_failure_reason: args.p_failure_reason,
                changed: true,
              },
            };
          }
          completions.push(args);
          return { data: [{ success: true }] };
        },
      };
      const stripe = {
        charges: {
          retrieve: async () => {
            events.push('charge');
            return {
              amount: 756959,
              amount_refunded: 756959 - (options.remaining ?? 339326),
            };
          },
        },
        refunds: {
          create: async (...args: unknown[]) => {
            events.push('refund');
            refunds.push(args);
            if (options.providerError)
              throw new Error('charge_already_refunded');
            return {
              id: 're_target',
              payment_intent: 'pi_order',
              amount: 339326,
              status: options.refundStatus ?? 'succeeded',
              failure_reason: null,
            };
          },
        },
      };
      let error: unknown;
      let count: unknown;
      try {
        count = await adapter(name)(
          supabase,
          stripe,
          {
            id: 'target',
            order_id: 'order',
            stripe_payment_intent_id: options.shipmentPI ?? null,
          },
          (...args: unknown[]) => logs.push(args),
          runShipmentCancellation,
          computeShipmentRefundAmountCents,
          allocateCancellationLossCents,
          resolveAutoCancelShipmentCancellationGate,
        );
      } catch (caught) {
        error = caught;
      }
      return { events, refunds, completions, recordings, logs, error, count };
    }

    test('claims before reconstruction; second target uses order PI and uncapped sibling loss weights', async () => {
      const result = await run();
      expect(result.error).toBeUndefined();
      expect(result.count).toBe(1);
      expect(result.events[0]).toBe('fn_claim_shipment_cancellation');
      expect(result.refunds).toEqual([
        [
          {
            payment_intent: 'pi_order',
            amount: 339326,
            reason: 'requested_by_customer',
            metadata: {
              shipment_id: 'target',
              order_id: 'order',
              caller_role: 'system',
              reason:
                name === 'auto-cancel-orders'
                  ? 'Cancelación automática: Excedió el límite de 80 horas para envío.'
                  : 'Cancelación automática: Envío en preparación por más de 80 horas sin escaneo del carrier.',
              seguro_share_cents: 14326,
            },
          },
          { idempotencyKey: 'cancel_shipment_target' },
        ],
      ]);
      expect(result.completions[0]).toMatchObject({
        p_cancelled_by_role: 'system',
        p_cancellation_loss_cents: 14326,
      });
      expect(result.recordings).toEqual([
        {
          p_shipment_id: 'target',
          p_refund_id: 're_target',
          p_payment_intent_id: 'pi_order',
          p_amount_cents: 339326,
          p_status: 'succeeded',
          p_failure_reason: null,
        },
      ]);
      const at = (rpc: string) => result.events.indexOf(rpc);
      expect(at('fn_record_shipment_cancellation_refund')).toBeGreaterThan(
        at('fn_start_shipment_cancellation_refund'),
      );
      expect(at('fn_cancel_shipment')).toBeGreaterThan(
        at('fn_record_shipment_cancellation_refund'),
      );
    });
    test('a pending refund is recorded once and never cancels the shipment', async () => {
      const result = await run({ refundStatus: 'pending' });
      expect(result.refunds).toHaveLength(1);
      expect(result.recordings).toHaveLength(1);
      expect(result.recordings[0]).toMatchObject({
        p_refund_id: 're_target',
        p_status: 'pending',
      });
      expect(result.events).not.toContain('fn_cancel_shipment');
      expect(result.completions).toEqual([]);
    });
    test('concurrent and repeated adapters do not issue another refund', async () => {
      const reservation = { claimed: false, started: false };
      const attempts = await Promise.all([
        run({ reservation }),
        run({ reservation }),
      ]);
      const repeated = await run({ reservation });
      expect(attempts.map((attempt) => attempt.error)).toEqual([
        undefined,
        undefined,
      ]);
      expect(attempts.flatMap((attempt) => attempt.refunds)).toHaveLength(1);
      expect(attempts.flatMap((attempt) => attempt.completions)).toHaveLength(
        1,
      );
      expect(repeated.events).toEqual(['fn_claim_shipment_cancellation']);
      expect(repeated.refunds).toEqual([]);
      expect(repeated.completions).toEqual([]);
      expect(JSON.stringify(repeated.logs)).toContain('recovery_required');
    });
    test('preserves first cancellation and shipment PI precedence', async () => {
      const result = await run({
        remaining: 756959,
        shipmentPI: 'pi_shipment',
      });
      expect(result.error).toBeUndefined();
      expect(result.count).toBe(1);
      expect(result.refunds).toHaveLength(1);
      expect(JSON.stringify(result.refunds)).toContain(
        '"payment_intent":"pi_shipment"',
      );
      expect(result.completions[0]).toMatchObject({
        p_shipment_id: 'target',
        p_cancellation_loss_cents: 14326,
      });
    });
    for (const status of ['busy', 'recovery_required'])
      test(`${status} skips all financial and business work explicitly`, async () => {
        const result = await run({ status });
        expect(result.events).toEqual(['fn_claim_shipment_cancellation']);
        expect(result.refunds).toEqual([]);
        expect(result.completions).toEqual([]);
        expect(JSON.stringify(result.logs)).toContain(status);
        expect(result.count).toBe(0);
      });
    for (const rpcErrorAt of [
      'fn_claim_shipment_cancellation',
      'fn_start_shipment_cancellation_refund',
    ])
      test(`${rpcErrorAt} rejection surfaces its SQL reason without effects`, async () => {
        const result = await run({ rpcErrorAt });
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toBe(
          'SHIPMENT_LABEL_OPERATION_ACTIVE',
        );
        expect(result.refunds).toEqual([]);
        expect(result.completions).toEqual([]);
        expect(result.count).toBeUndefined();
      });
    test('failed start cannot refund or cancel', async () => {
      const result = await run({ failStart: true });
      expect(String(result.error)).toContain('start denied');
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
    });
    for (const options of [
      { missingPI: true },
      { invalid: true },
      { remaining: 339325 },
    ])
      test(`invalid basis cannot start: ${JSON.stringify(options)}`, async () => {
        const result = await run(options);
        expect(result.error).toBeDefined();
        expect(result.events).not.toContain(
          'fn_start_shipment_cancellation_refund',
        );
        expect(result.refunds).toEqual([]);
        expect(result.completions).toEqual([]);
      });
    for (const options of [
      { refundStatus: 'pending' },
      { providerError: true },
    ])
      test(`unconfirmed refund stays fenced: ${JSON.stringify(options)}`, async () => {
        const result = await run(options);
        expect(result.error).toBeDefined();
        expect(result.refunds).toHaveLength(1);
        expect(result.completions).toEqual([]);
      });
    for (const source of ['buyer', 'seller'])
      test(`takeover preserves ${source} context`, async () => {
        const result = await run({ source });
        expect(result.error).toBeUndefined();
        expect(result.completions[0]).toMatchObject({
          p_cancelled_by_role: source,
          p_reason: 'Original reason',
        });
        expect(JSON.stringify(result.refunds)).toContain(
          `"caller_role":"${source}"`,
        );
      });
    test('preserves settings, timeout selection and global locks', () => {
      const source = readFileSync(
        new URL(`../${name}/index.ts`, import.meta.url),
        'utf8',
      );
      const paid = name === 'auto-cancel-orders';
      expect(source).toContain(
        paid
          ? 'settings?.order_expiration_hours || 48'
          : 'settings?.preparing_expiration_hours || 72',
      );
      expect(source).toContain(
        paid
          ? ".lt('created_at', expirationLimit)"
          : ".lt('updated_at', expirationLimit)",
      );
      expect(source).toContain(
        paid ? ".eq('status', 'paid')" : ".eq('status', 'preparing')",
      );
      expect(source).toContain(
        paid
          ? 'auto_cancel_orders_running: false'
          : 'auto_cancel_preparing_running: false',
      );
      expect(source).not.toContain('charge_already_refunded');
    });
  });
}
