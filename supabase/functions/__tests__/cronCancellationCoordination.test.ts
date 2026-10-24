import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runShipmentCancellation } from '../_shared/shipment-cancellation';
import {
  allocateCancellationLossCents,
  computeShipmentRefundAmountCents,
} from '../_shared/refund-basis';
import { resolveAutoCancelShipmentCancellationGate } from '../_shared/auto-cancel-safety';
import { isAuthorizedCronRequest } from '../_shared/cron-auth';

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
    `async function execute(supabaseAdmin, stripe, shipment, log, runShipmentCancellation, computeShipmentRefundAmountCents, allocateCancellationLossCents, resolveAutoCancelShipmentCancellationGate, reportCritical) { let successCount = 0; const hours = 80; ${source.slice(start, end)} return successCount; }`,
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
        recovery?: Record<string, unknown> | null;
        recoveryRpcError?: boolean;
        unrecorded?: boolean;
        listError?: string;
        retrieveError?: string;
        hoursSinceStart?: number;
        escalated?: boolean;
        escalateResult?: unknown;
        escalateError?: string;
      } = {},
    ) {
      const expectedSource =
        name === 'auto-cancel-orders' ? 'paid_timeout' : 'preparing_timeout';
      const events: string[] = [];
      const refunds: unknown[] = [];
      const completions: Record<string, unknown>[] = [];
      const recordings: Record<string, unknown>[] = [];
      const logs: unknown[] = [];
      const critical: unknown[][] = [];
      const listed: unknown[] = [];
      const retrieved: unknown[] = [];
      const escalations: unknown[] = [];
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
      const recoveryOperation = () => ({
        operation_key: 'cancel_shipment_target',
        order_id: 'order',
        source: options.source ?? expectedSource,
        actor_id: options.source ? 'original_actor' : null,
        reason: options.source ? 'Original reason' : 'Stored reason',
        refund_request: {
          payment_intent: 'pi_order',
          amount: 339326,
          reason: 'requested_by_customer',
          metadata: {
            shipment_id: 'target',
            order_id: 'order',
            caller_role: options.source ?? 'system',
            reason: options.source ? 'Original reason' : 'Stored reason',
            seguro_share_cents: 14326,
          },
        },
        cancellation_loss_cents: 14326,
        refund_id: options.unrecorded ? null : 're_target',
        refund_status: options.unrecorded
          ? null
          : (options.refundStatus ?? 'succeeded'),
        external_started_at: new Date(
          Date.now() - (options.hoursSinceStart ?? 0) * 60 * 60 * 1000,
        ).toISOString(),
        recovery_escalated_at: options.escalated
          ? new Date().toISOString()
          : null,
      });
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
          if (name === 'fn_get_shipment_cancellation_recovery') {
            expect(args).toEqual({ p_shipment_id: 'target' });
            if (options.recoveryRpcError)
              return { error: { message: 'recovery rpc secret' } };
            return {
              data:
                options.recovery === undefined
                  ? recoveryOperation()
                  : options.recovery,
            };
          }
          if (name === 'fn_escalate_shipment_cancellation') {
            escalations.push(args);
            if (options.escalateError)
              return { error: { message: options.escalateError } };
            return { data: options.escalateResult ?? { escalated: true } };
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
          list: (params: unknown) => {
            listed.push(params);
            return {
              autoPagingToArray: async () => {
                if (options.listError) throw new Error(options.listError);
                return [];
              },
            };
          },
          retrieve: async (id: string) => {
            retrieved.push(id);
            if (options.retrieveError) throw new Error(options.retrieveError);
            return {
              id,
              payment_intent: 'pi_order',
              amount: 339326,
              status: options.refundStatus ?? 'pending',
              failure_reason: null,
              metadata: { shipment_id: 'target' },
            };
          },
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
              metadata: { shipment_id: 'target' },
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
          async (...args: unknown[]) => {
            critical.push(args);
          },
        );
      } catch (caught) {
        error = caught;
      }
      return {
        events,
        refunds,
        completions,
        recordings,
        logs,
        critical,
        listed,
        retrieved,
        escalations,
        error,
        count,
      };
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
      // The repeated run converges from the recorded succeeded refund: no new money.
      expect(repeated.events).toEqual([
        'fn_claim_shipment_cancellation',
        'fn_get_shipment_cancellation_recovery',
        'fn_cancel_shipment',
      ]);
      expect(repeated.refunds).toEqual([]);
      expect(repeated.listed).toEqual([]);
      expect(repeated.completions).toEqual([
        expect.objectContaining({
          p_shipment_id: 'target',
          p_cancelled_by_role: 'system',
          p_reason: 'Stored reason',
          p_cancellation_loss_cents: 14326,
        }),
      ]);
      expect(repeated.count).toBe(1);
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
    test('busy skips all financial and business work explicitly', async () => {
      const result = await run({ status: 'busy' });
      expect(result.events).toEqual(['fn_claim_shipment_cancellation']);
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
      expect(JSON.stringify(result.logs)).toContain('busy');
      expect(result.count).toBe(0);
    });
    test('recovery_required with a recorded succeeded refund completes with the stored winner and creates no refund', async () => {
      const result = await run({
        status: 'recovery_required',
        source: 'seller',
      });
      expect(result.error).toBeUndefined();
      expect(result.events).toEqual([
        'fn_claim_shipment_cancellation',
        'fn_get_shipment_cancellation_recovery',
        'fn_cancel_shipment',
      ]);
      expect(result.refunds).toEqual([]);
      expect(result.listed).toEqual([]);
      expect(result.completions).toEqual([
        expect.objectContaining({
          p_cancelled_by_role: 'seller',
          p_reason: 'Original reason',
          p_cancellation_loss_cents: 14326,
        }),
      ]);
      expect(result.count).toBe(1);
    });
    for (const refundStatus of ['failed', 'canceled'])
      test(`recovery_required with a recorded ${refundStatus} refund makes no Stripe call and no cancellation`, async () => {
        const result = await run({ status: 'recovery_required', refundStatus });
        expect(result.error).toBeUndefined();
        expect(result.events).toEqual([
          'fn_claim_shipment_cancellation',
          'fn_get_shipment_cancellation_recovery',
        ]);
        expect(result.refunds).toEqual([]);
        expect(result.listed).toEqual([]);
        expect(result.retrieved).toEqual([]);
        expect(result.completions).toEqual([]);
        expect(JSON.stringify(result.logs)).toContain('recovery_required');
        expect(result.count).toBe(0);
      });
    test('recovery_required with a recorded pending refund retrieves it by id and never completes', async () => {
      const result = await run({
        status: 'recovery_required',
        refundStatus: 'pending',
      });
      expect(String(result.error)).toContain('CANCELLATION_REFUND_UNCONFIRMED');
      expect(result.retrieved).toEqual(['re_target']);
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
    });
    test('recovery_required with nothing recorded lists refunds by payment_intent, then replays the same key', async () => {
      const result = await run({
        status: 'recovery_required',
        unrecorded: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.listed).toEqual([
        { payment_intent: 'pi_order', limit: 100 },
      ]);
      expect(result.refunds).toHaveLength(1);
      expect((result.refunds[0] as unknown[])[1]).toEqual({
        idempotencyKey: 'cancel_shipment_target',
      });
      expect(result.recordings).toHaveLength(1);
      expect(result.completions).toHaveLength(1);
    });
    test('an unreadable recovery operation surfaces a stable code and leaks no RPC text', async () => {
      const result = await run({
        status: 'recovery_required',
        recoveryRpcError: true,
      });
      expect((result.error as Error).message).toBe(
        'CANCELLATION_RECOVERY_UNAVAILABLE',
      );
      expect(JSON.stringify(result.logs)).toContain('recovery rpc secret');
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
    });
    test.each([
      [
        'list',
        { unrecorded: true, listError: 'stripe list secret' },
        'stripe list secret',
      ],
      [
        'retrieve',
        { refundStatus: 'pending', retrieveError: 'stripe retrieve secret' },
        'stripe retrieve secret',
      ],
    ])('a Stripe %s failure surfaces CANCELLATION_REFUND_LOOKUP_FAILED, logs the Stripe text and creates nothing', async (action, options, raw) => {
      const result = await run({ status: 'recovery_required', ...options });
      expect((result.error as Error).message).toBe(
        'CANCELLATION_REFUND_LOOKUP_FAILED',
      );
      expect(JSON.stringify(result.logs)).toContain(raw);
      expect(JSON.stringify(result.logs)).toContain(action);
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
    });
    test('a refund missing after 24 h escalates once, alerts, and creates nothing', async () => {
      const result = await run({
        status: 'recovery_required',
        unrecorded: true,
        hoursSinceStart: 24,
      });
      expect(result.error).toBeUndefined();
      expect(result.count).toBe(0);
      expect(result.escalations).toEqual([
        { p_shipment_id: 'target', p_reason: 'refund_not_found' },
      ]);
      expect(result.critical).toHaveLength(1);
      expect(result.critical[0]![0]).toBe('CANCELLATION_REFUND_NOT_FOUND');
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
    });
    test('a repeated escalation does not alert again', async () => {
      const result = await run({
        status: 'recovery_required',
        unrecorded: true,
        hoursSinceStart: 24,
        escalateResult: { escalated: false },
      });
      expect(result.error).toBeUndefined();
      expect(result.escalations).toHaveLength(1);
      expect(result.critical).toEqual([]);
    });
    test('an already escalated shipment costs no Stripe list, no escalation and no alert', async () => {
      const result = await run({
        status: 'recovery_required',
        unrecorded: true,
        hoursSinceStart: 48,
        escalated: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.count).toBe(0);
      expect(result.listed).toEqual([]);
      expect(result.escalations).toEqual([]);
      expect(result.critical).toEqual([]);
      expect(result.refunds).toEqual([]);
    });
    test('an escalation RPC error still alerts, logs the RPC text and never creates a refund', async () => {
      const result = await run({
        status: 'recovery_required',
        unrecorded: true,
        hoursSinceStart: 24,
        escalateError: 'escalate secret detail',
      });
      expect(result.error).toBeUndefined();
      expect(result.critical).toHaveLength(1);
      expect(JSON.stringify(result.logs)).toContain('escalate secret detail');
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
    });
    test('a database cancellation failure after a recorded refund is reported as critical and still throws', async () => {
      const result = await run({ rpcErrorAt: 'fn_cancel_shipment' });
      expect(result.error).toBeInstanceOf(Error);
      expect(result.critical).toHaveLength(1);
      expect(result.critical[0]![0]).toBe(
        'Refund succeeded but database cancellation failed; manual review required',
      );
      expect(result.critical[0]![1]).toMatchObject({ shipmentId: 'target' });
      expect(result.refunds).toHaveLength(1);
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
      // This order's fee shares round to the exact fee, so even one missing cent is not rounding.
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
    // Runs the whole handler with stubbed imports; `lease` decides what the lease helper returns.
    // `settings` controls the system_settings read; without it the read throws.
    function runHandler(
      lease: { acquired: boolean },
      settings?: { data: unknown; error?: unknown },
      report: { data: unknown; error?: unknown } = { data: [], error: null },
    ) {
      const source = readFileSync(
        new URL(`../${name}/index.ts`, import.meta.url),
        'utf8',
      );
      const executable = new Bun.Transpiler({ loader: 'ts' }).transformSync(
        source.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, ''),
      );
      const job = name === 'auto-cancel-orders' ? 'orders' : 'preparing';
      const logs: Record<string, unknown>[] = [];
      const tables: string[] = [];
      const leaseCalls: unknown[][] = [];
      let clientsCreated = 0;
      let handler!: (req: Request) => Promise<Response>;
      const shipmentQuery: unknown[][] = [];
      // One entry per from('shipments') call; the report query is the one that uses `not`.
      const shipmentQueries: unknown[][][] = [];
      const query: Record<string, unknown> = {
        select: () => query,
        update: () => query,
        eq: () => query,
        single: async () => {
          if (settings) return { error: null, ...settings };
          throw new Error('secret db detail');
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(resolve({})),
      };
      const newShipmentsChain = () => {
        const recorded: unknown[][] = [];
        shipmentQueries.push(recorded);
        const chain: Record<string, unknown> = {
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(
              resolve(
                recorded.some(([method]) => method === 'not')
                  ? { error: null, ...report }
                  : { data: [], error: null },
              ),
            ),
        };
        for (const method of ['select', 'eq', 'is', 'lt', 'not', 'in', 'order', 'limit'])
          chain[method] = (...args: unknown[]) => {
            shipmentQuery.push([method, ...args]);
            recorded.push([method, ...args]);
            return chain;
          };
        return chain;
      };
      const held = new Response(JSON.stringify({ message: 'Already running' }));
      new Function(
        'serve',
        'createClient',
        'Stripe',
        'Deno',
        'console',
        'withSentry',
        'createCancellationReporter',
        'runShipmentCancellation',
        'resolveAutoCancelShipmentCancellationGate',
        'allocateCancellationLossCents',
        'computeShipmentRefundAmountCents',
        'buildStripeFeeReconciliationPlan',
        'acquireAutoCancelLease',
        'releaseAutoCancelLease',
        'isAuthorizedCronRequest',
        executable,
      )(
        (callback: typeof handler) => {
          handler = callback;
        },
        () => {
          clientsCreated += 1;
          return {
            from: (table: string) => {
              tables.push(table);
              return table === 'shipments' ? newShipmentsChain() : query;
            },
          };
        },
        class {
          static createFetchHttpClient() {
            return {};
          }
        },
        { env: { get: () => 'fake' } },
        { log: (value: string) => logs.push(JSON.parse(value)) },
        (_name: string, callback: typeof handler) => callback,
        () => async () => undefined,
        runShipmentCancellation,
        resolveAutoCancelShipmentCancellationGate,
        allocateCancellationLossCents,
        computeShipmentRefundAmountCents,
        () => undefined,
        async (_client: unknown, leaseJob: string) => {
          leaseCalls.push(['acquire', leaseJob]);
          return lease.acquired
            ? { acquired: true, leaseId: 'lease-1', budgetExceeded: () => false }
            : { acquired: false, response: held };
        },
        async (_client: unknown, leaseJob: string, leaseId: unknown) => {
          leaseCalls.push(['release', leaseJob, leaseId]);
        },
        isAuthorizedCronRequest,
      );
      // The stubbed Deno.env returns 'fake' for every key, including CRON_SECRET.
      const call = (
        headers: Record<string, string> = { 'x-cron-secret': 'fake' },
      ) => handler(new Request('http://localhost/', { method: 'POST', headers }));
      return {
        run: () => call(),
        call,
        logs,
        tables,
        leaseCalls,
        job,
        held,
        shipmentQuery,
        shipmentQueries,
        clientsCreated: () => clientsCreated,
      };
    }

    test('a top-level failure returns a stable INTERNAL_ERROR, logs the raw error and releases the lease', async () => {
      const { run, logs, leaseCalls, job } = runHandler({ acquired: true });
      const response = await run();
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('{"error":"INTERNAL_ERROR"}');
      expect(logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: `Fallo crítico en ${name}`,
          error: 'secret db detail',
        }),
      );
      expect(leaseCalls).toEqual([
        ['acquire', job],
        ['release', job, 'lease-1'],
      ]);
    });
    for (const [label, headers] of [
      ['no secret', {}],
      ['a wrong secret', { 'x-cron-secret': 'not-the-secret' }],
      ['only an Authorization bearer', { Authorization: 'Bearer fake' }],
    ] as const)
      test(`${label} returns 401 UNAUTHORIZED before any client, lease or table is touched`, async () => {
        const { call, tables, leaseCalls, clientsCreated } = runHandler({
          acquired: true,
        });
        const response = await call({ ...headers });
        expect(response.status).toBe(401);
        expect(response.headers.get('Content-Type')).toBe('application/json');
        expect(await response.text()).toBe('{"error":"UNAUTHORIZED"}');
        expect(clientsCreated()).toBe(0);
        expect(leaseCalls).toEqual([]);
        expect(tables).toEqual([]);
      });
    test('a lease held by another run returns its response without reading settings or shipments', async () => {
      const { run, tables, leaseCalls, job, held } = runHandler({ acquired: false });
      expect(await run()).toBe(held);
      expect(tables).toEqual([]);
      // Nothing acquired, so the release call carries no lease id and does nothing.
      expect(leaseCalls).toEqual([
        ['acquire', job],
        ['release', job, undefined],
      ]);
    });
    const paidJob = name === 'auto-cancel-orders';
    const column = paidJob ? 'order_expiration_hours' : 'preparing_expiration_hours';
    const timestampColumn = paidJob ? 'created_at' : 'updated_at';
    for (const [label, settings] of [
      ['null', { data: { [column]: null } }],
      ['0', { data: { [column]: 0 } }],
      ['-1', { data: { [column]: -1 } }],
      ['1.5', { data: { [column]: 1.5 } }],
      ['a missing row', { data: null }],
      ['a read error', { data: null, error: { message: 'boom' } }],
    ] as const)
      test(`an invalid ${column} (${label}) returns 500 AUTO_CANCEL_SETTINGS_INVALID, never queries shipments and releases the lease`, async () => {
        const { run, logs, tables, leaseCalls, job } = runHandler(
          { acquired: true },
          settings,
        );
        const response = await run();
        expect(response.status).toBe(500);
        expect(await response.text()).toBe('{"error":"AUTO_CANCEL_SETTINGS_INVALID"}');
        expect(logs).toContainEqual(
          expect.objectContaining({
            level: 'ERROR',
            msg: 'Auto-cancel settings invalid',
            setting: column,
          }),
        );
        expect(tables).not.toContain('shipments');
        expect(leaseCalls).toEqual([
          ['acquire', job],
          ['release', job, 'lease-1'],
        ]);
      });
    test(`a valid ${column} sets the limit from it and orders candidates oldest first`, async () => {
      const { run, shipmentQuery } = runHandler(
        { acquired: true },
        { data: { [column]: 5 } },
      );
      const before = Date.now();
      const response = await run();
      const after = Date.now();
      expect(response.status).toBe(200);
      const lt = shipmentQuery.find(([method]) => method === 'lt')!;
      expect(lt[1]).toBe(timestampColumn);
      const limit = new Date(lt[2] as string).getTime();
      expect(limit).toBeGreaterThanOrEqual(before - 5 * 3600 * 1000);
      expect(limit).toBeLessThanOrEqual(after - 5 * 3600 * 1000);
      const methods = shipmentQuery.map(([method]) => method);
      expect(shipmentQuery).toContainEqual(['order', timestampColumn, { ascending: true }]);
      expect(methods.indexOf('order')).toBeLessThan(methods.indexOf('limit'));
      expect(shipmentQuery).toContainEqual(['limit', 50]);
    });
    const blockedWarn = 'Expired paid shipments blocked by a label operation; manual review required';
    const hoursSetting = { data: { [column]: 5 } };
    if (paidJob) {
      test('candidates are limited to shipments whose label state allows a claim', async () => {
        const { run, shipmentQueries } = runHandler({ acquired: true }, hoursSetting);
        expect((await run()).status).toBe(200);
        const candidate = shipmentQueries.find(
          (recorded) => !recorded.some(([method]) => method === 'not'),
        )!;
        expect(candidate).toContainEqual([
          'in',
          'label_generation_state',
          ['unclaimed', 'retryable_rejected'],
        ]);
      });
      test('blocked expired shipments are reported once for manual review with the exact report query', async () => {
        const { run, logs, shipmentQueries } = runHandler(
          { acquired: true },
          hoursSetting,
          { data: [{ id: 's1' }, { id: 's2' }] },
        );
        const response = await run();
        expect(response.status).toBe(200);
        const warns = logs.filter((entry) => entry.msg === blockedWarn);
        expect(warns).toHaveLength(1);
        expect(warns[0]).toMatchObject({ level: 'WARN', shipmentIds: ['s1', 's2'] });
        const reportQuery = shipmentQueries.find((recorded) =>
          recorded.some(([method]) => method === 'not'),
        )!;
        expect(reportQuery.map(([method]) => method)).toEqual([
          'select', 'eq', 'is', 'lt', 'not', 'order', 'limit',
        ]);
        expect(reportQuery).toContainEqual(['select', 'id']);
        expect(reportQuery).toContainEqual(['eq', 'status', 'paid']);
        expect(reportQuery).toContainEqual(['is', 'tracking_number', null]);
        expect(reportQuery.find(([method]) => method === 'lt')![1]).toBe('created_at');
        expect(reportQuery).toContainEqual([
          'not', 'label_generation_state', 'in', '(unclaimed,retryable_rejected)',
        ]);
        expect(reportQuery).toContainEqual(['order', 'created_at', { ascending: true }]);
        expect(reportQuery).toContainEqual(['limit', 50]);
      });
      test('no blocked shipments means no review warning', async () => {
        const { run, logs } = runHandler({ acquired: true }, hoursSetting);
        expect((await run()).status).toBe(200);
        expect(logs.filter((entry) => entry.msg === blockedWarn)).toEqual([]);
      });
      test('a report read error is logged by message and never blocks the candidate query', async () => {
        const { run, logs, shipmentQueries } = runHandler(
          { acquired: true },
          hoursSetting,
          { data: null, error: { message: 'boom' } },
        );
        const response = await run();
        expect(response.status).toBe(200);
        const failure = logs.find((entry) => entry.level === 'ERROR');
        expect(failure).toBeDefined();
        expect(JSON.stringify(failure)).toContain('boom');
        expect(JSON.stringify(failure)).not.toContain('[object Object]');
        expect(logs.filter((entry) => entry.msg === blockedWarn)).toEqual([]);
        expect(
          shipmentQueries.some(
            (recorded) => !recorded.some(([method]) => method === 'not'),
          ),
        ).toBe(true);
      });
    } else {
      test('the preparing query keeps no label state filter and no report query', async () => {
        const { run, shipmentQueries, shipmentQuery } = runHandler(
          { acquired: true },
          hoursSetting,
        );
        expect((await run()).status).toBe(200);
        expect(shipmentQueries).toHaveLength(1);
        expect(JSON.stringify(shipmentQuery)).not.toContain('label_generation_state');
      });
    }
    test('preserves settings and timeout selection, without the legacy boolean lock', () => {
      const source = readFileSync(
        new URL(`../${name}/index.ts`, import.meta.url),
        'utf8',
      );
      const paid = name === 'auto-cancel-orders';
      expect(source).not.toContain('expiration_hours || ');
      expect(source).toContain(
        paid
          ? ".lt('created_at', expirationLimit)"
          : ".lt('updated_at', expirationLimit)",
      );
      expect(source).toContain(
        paid ? ".eq('status', 'paid')" : ".eq('status', 'preparing')",
      );
      expect(source).not.toContain('_running');
      expect(source).not.toContain('charge_already_refunded');
    });
  });
}
