import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { createAutoCancelOrdersHandler } from '../auto-cancel-orders/handler.ts';
import { createAutoCancelPreparingHandler } from '../auto-cancel-preparing/handler.ts';

// Both auto-cancel crons, driven through their handlers with a recording fake Supabase client,
// Stripe client, Envia fetch and clock. The shared lease, settings, cancellation orchestration,
// refund basis and carrier gate are the real modules.

type Row = Record<string, unknown>;
type RpcResult = { data?: unknown; error?: unknown };
type QueryCall = [string, ...unknown[]];
type Name = 'auto-cancel-orders' | 'auto-cancel-preparing';

const CRON_SECRET = 'cron-secret-value';
const SUPABASE_URL = 'http://supabase.test';
const SECRET_KEY = 'sb_secret_fake';
const START = Date.parse('2026-11-11T12:00:00.000Z');
const ENVIA_KEY = 'envia-key-secret';
const BASE_ENV: Record<string, string> = {
  CRON_SECRET,
  SUPABASE_URL,
  ENVIA_MODE: 'sandbox',
  ENVIA_API_KEY_SANDBOX: ENVIA_KEY,
  ENVIA_API_URL_SANDBOX: 'https://envia.test/',
};
// Handler-level calls; `events` keeps only the per-shipment work.
const RUN_LEVEL = new Set([
  'createSupabaseAdmin',
  'createStripe',
  'sleep',
  'system_settings',
  'shipments',
  'fn_acquire_cron_lease',
  'fn_release_cron_lease',
  'fn_notify_label_deadline_reminders',
]);
const UNSCANNED_TRACKING = {
  status: 200,
  body: { data: [{ trackingNumber: 'TRK-9', status: 'Created' }] },
};
const ACCEPTED_CANCEL = {
  status: 200,
  body: {
    meta: 'cancel',
    data: {
      trackingNumber: 'TRK-9',
      balanceReturned: 1,
      balanceReturnDate: '2026-10-23T11:00:00.000Z',
    },
  },
};

interface EnviaReply {
  status: number;
  body: unknown;
}

interface Scenario {
  headers?: Record<string, string>;
  env?: Record<string, string | undefined>;
  secretKey?: string;
  lease?: RpcResult;
  settings?: RpcResult | 'throw';
  hours?: number;
  reminders?: RpcResult;
  report?: RpcResult;
  candidates?: Row[];
  candidatesError?: { message: string };
  sleepAdvanceMs?: number;
  reportMessageFails?: boolean;
  // Per-shipment Supabase and Stripe answers.
  status?: string;
  reservation?: { claimed: boolean; started: boolean };
  failStart?: boolean;
  rpcErrorAt?: string;
  rpcErrorMessage?: string;
  missingPI?: boolean;
  shipmentPI?: string;
  invalid?: boolean;
  remaining?: number;
  feeCents?: number | null;
  balanceFeeCents?: number;
  feeUpdateError?: { message: string };
  refundStatus?: string;
  providerError?: boolean;
  source?: string;
  recovery?: Row | null;
  recoveryRpcError?: boolean;
  unrecorded?: boolean;
  listError?: string;
  retrieveError?: string;
  hoursSinceStart?: number;
  escalated?: boolean;
  escalateResult?: unknown;
  escalateError?: string;
  // Carrier gate answers (preparing only).
  carrierState?: unknown;
  carrierStateError?: string;
  tracking?: EnviaReply[];
  cancel?: EnviaReply[];
  trackingEventStatus?: string;
  markReview?: unknown;
}

let consoleLines: Row[] = [];

beforeEach(() => {
  consoleLines = [];
  spyOn(console, 'log').mockImplementation((line: unknown) => {
    consoleLines.push(JSON.parse(String(line)) as Row);
  });
});

afterEach(() => {
  (console.log as unknown as { mockRestore: () => void }).mockRestore();
});

const targetRow = (s: Scenario, name: Name): Row => ({
  id: 'target',
  order_id: 'order',
  seller_id: 'seller',
  stripe_payment_intent_id: s.shipmentPI ?? null,
  status: name === 'auto-cancel-orders' ? 'paid' : 'preparing',
  stripe_transfer_id: null,
  ...(name === 'auto-cancel-preparing'
    ? { tracking_number: 'TRK-9', carrier: 'estafeta' }
    : {}),
});

async function runCron(name: Name, s: Scenario = {}) {
  const paid = name === 'auto-cancel-orders';
  const column = paid ? 'order_expiration_hours' : 'preparing_expiration_hours';
  const expectedSource = paid ? 'paid_timeout' : 'preparing_timeout';
  const env: Record<string, string | undefined> = { ...BASE_ENV, ...s.env };
  const logStart = consoleLines.length;
  const timeline: string[] = [];
  const rpcCalls: [string, Row][] = [];
  const queries: { table: string; calls: QueryCall[] }[] = [];
  const refunds: unknown[][] = [];
  const completions: Row[] = [];
  const recordings: Row[] = [];
  const listed: unknown[] = [];
  const retrieved: unknown[] = [];
  const escalations: Row[] = [];
  const charges: unknown[][] = [];
  const reports: unknown[][] = [];
  const fetches: {
    url: string;
    authorization: string | null;
    body: unknown;
  }[] = [];
  const sleeps: number[] = [];
  const envReads: string[] = [];
  const supabaseClients: unknown[][] = [];
  let stripeClients = 0;
  let clock = START;
  const trackingReplies = [...(s.tracking ?? [UNSCANNED_TRACKING])];
  const cancelReplies = [...(s.cancel ?? [ACCEPTED_CANCEL])];

  const order = {
    stripe_charge_id: 'ch',
    total_amount: 7569.59,
    stripe_payment_intent_id: s.missingPI ? null : 'pi_order',
    actual_stripe_fee_cents: s.feeCents === undefined ? 31959 : s.feeCents,
    stripe_fee_reconciled_at: null,
  };
  const items = [
    {
      shipment_id: 'target',
      price_at_purchase: s.invalid ? 0 : 3250,
      shipping_amount: 900,
    },
    { shipment_id: 'sibling', price_at_purchase: 4000, shipping_amount: 900 },
  ];
  const recoveryOperation = () => ({
    operation_key: 'cancel_shipment_target',
    order_id: 'order',
    source: s.source ?? expectedSource,
    actor_id: s.source ? 'original_actor' : null,
    reason: s.source ? 'Original reason' : 'Stored reason',
    refund_request: {
      payment_intent: 'pi_order',
      amount: 339326,
      reason: 'requested_by_customer',
      metadata: {
        shipment_id: 'target',
        order_id: 'order',
        caller_role: s.source ?? 'system',
        reason: s.source ? 'Original reason' : 'Stored reason',
        seguro_share_cents: 14326,
      },
    },
    cancellation_loss_cents: 14326,
    refund_id: s.unrecorded ? null : 're_target',
    refund_status: s.unrecorded ? null : (s.refundStatus ?? 'succeeded'),
    external_started_at: new Date(
      Date.now() - (s.hoursSinceStart ?? 0) * 60 * 60 * 1000,
    ).toISOString(),
    recovery_escalated_at: s.escalated ? new Date().toISOString() : null,
  });

  const resolveQuery = (table: string, calls: QueryCall[]): RpcResult => {
    const used = (method: string) => calls.some(([m]) => m === method);
    if (table === 'system_settings') {
      if (s.settings === 'throw') throw new Error('secret db detail');
      return s.settings ?? { data: { [column]: s.hours ?? 80 }, error: null };
    }
    if (table === 'shipments') {
      if (used('not')) return s.report ?? { data: [], error: null };
      if (s.candidatesError) return { data: null, error: s.candidatesError };
      return { data: s.candidates ?? [targetRow(s, name)], error: null };
    }
    if (table === 'order_items') return { data: items, error: null };
    if (table === 'orders') {
      return used('update')
        ? { data: null, error: s.feeUpdateError ?? null }
        : { data: order, error: null };
    }
    throw new Error(`unexpected table ${table}`);
  };

  const supabase = {
    from(table: string) {
      timeline.push(table);
      const calls: QueryCall[] = [];
      queries.push({ table, calls });
      const chain: Row = {};
      for (const method of [
        'select',
        'update',
        'eq',
        'is',
        'lt',
        'not',
        'in',
        'order',
        'limit',
      ])
        chain[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return chain;
        };
      chain.single = async () => {
        calls.push(['single']);
        return resolveQuery(table, calls);
      };
      chain.then = (
        onFulfilled: (value: unknown) => unknown,
        onRejected: (reason: unknown) => unknown,
      ) =>
        Promise.resolve()
          .then(() => resolveQuery(table, calls))
          .then(onFulfilled, onRejected);
      return chain;
    },
    async rpc(rpcName: string, args: Row = {}): Promise<RpcResult> {
      timeline.push(rpcName);
      rpcCalls.push([rpcName, args]);
      // supabase-js returns PostgrestError as a plain object, not an Error.
      if (s.rpcErrorAt === rpcName)
        return {
          error: {
            message: s.rpcErrorMessage ?? 'SHIPMENT_LABEL_OPERATION_ACTIVE',
            code: 'P0001',
            details: null,
            hint: null,
          },
        };
      switch (rpcName) {
        case 'fn_acquire_cron_lease':
          return (
            s.lease ?? {
              data: [{ acquired: true, lease_id: 'lease-1' }],
              error: null,
            }
          );
        case 'fn_release_cron_lease':
          return { data: true, error: null };
        case 'fn_notify_label_deadline_reminders':
          return s.reminders ?? { data: 2, error: null };
        case 'fn_claim_shipment_cancellation': {
          if (s.reservation) {
            if (s.reservation.started)
              return { data: { status: 'recovery_required' } };
            if (s.reservation.claimed) return { data: { status: 'busy' } };
            s.reservation.claimed = true;
          }
          return {
            data: {
              status: s.status ?? 'claimed',
              operation_key: `cancel_shipment_${String(args.p_shipment_id)}`,
              claim_token: 'token',
              source: s.source ?? args.p_source,
              actor_id: s.source ? 'original_actor' : null,
              reason: s.source ? 'Original reason' : args.p_reason,
            },
          };
        }
        case 'fn_get_shipment_cancellation_recovery':
          if (s.recoveryRpcError)
            return { error: { message: 'recovery rpc secret' } };
          return {
            data: s.recovery === undefined ? recoveryOperation() : s.recovery,
          };
        case 'fn_escalate_shipment_cancellation':
          escalations.push(args);
          if (s.escalateError) return { error: { message: s.escalateError } };
          return { data: s.escalateResult ?? { escalated: true } };
        case 'fn_start_shipment_cancellation_refund':
          if (s.reservation) s.reservation.started = true;
          return s.failStart
            ? { error: new Error('start denied') }
            : {
                data: {
                  operation_key: 'cancel_shipment_target',
                  refund_request: args.p_refund_request,
                  cancellation_loss_cents: args.p_cancellation_loss_cents,
                },
              };
        case 'fn_record_shipment_cancellation_refund':
          recordings.push(args);
          return {
            data: {
              refund_id: args.p_refund_id,
              refund_status: args.p_status,
              refund_failure_reason: args.p_failure_reason,
              changed: true,
            },
          };
        case 'fn_cancel_shipment':
          completions.push(args);
          return { data: [{ success: true }] };
        case 'fn_get_shipment_carrier_cancellation':
          if (s.carrierStateError)
            return { error: { message: s.carrierStateError } };
          return {
            data:
              s.carrierState === undefined
                ? { carrier_cancellation_outcome: 'accepted' }
                : s.carrierState,
            error: null,
          };
        case 'fn_record_tracking_event':
          return {
            data: {
              inserted: true,
              shipment_status: s.trackingEventStatus ?? 'shipped',
            },
            error: null,
          };
        case 'fn_record_shipment_carrier_cancellation':
          return { data: null, error: null };
        case 'fn_mark_shipment_cancellation_review':
          return { data: s.markReview ?? { marked: true }, error: null };
        default:
          throw new Error(`unexpected rpc ${rpcName}`);
      }
    },
  };

  const stripe = {
    charges: {
      retrieve: async (...args: unknown[]) => {
        timeline.push('charge');
        charges.push(args);
        return {
          id: 'ch',
          amount: 756959,
          amount_refunded: 756959 - (s.remaining ?? 339326),
          balance_transaction:
            s.balanceFeeCents === undefined ? null : { fee: s.balanceFeeCents },
        };
      },
    },
    refunds: {
      list: (params: unknown) => {
        listed.push(params);
        return {
          autoPagingToArray: async () => {
            if (s.listError) throw new Error(s.listError);
            return [];
          },
        };
      },
      retrieve: async (id: string) => {
        retrieved.push(id);
        if (s.retrieveError) throw new Error(s.retrieveError);
        return {
          id,
          payment_intent: 'pi_order',
          amount: 339326,
          status: s.refundStatus ?? 'pending',
          failure_reason: null,
          metadata: { shipment_id: 'target' },
        };
      },
      create: async (...args: unknown[]) => {
        timeline.push('refund');
        refunds.push(args);
        if (s.providerError) throw new Error('charge_already_refunded');
        return {
          id: 're_target',
          payment_intent: 'pi_order',
          amount: 339326,
          status: s.refundStatus ?? 'succeeded',
          failure_reason: null,
          metadata: { shipment_id: 'target' },
        };
      },
    },
  };

  const fakeFetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const path = url.includes('generaltrack') ? 'generaltrack' : 'cancel';
    timeline.push(`envia:${path}`);
    fetches.push({
      url,
      authorization: new Headers(init?.headers).get('Authorization'),
      body: JSON.parse(String(init?.body)),
    });
    const reply =
      (path === 'generaltrack' ? trackingReplies : cancelReplies).shift() ??
      (path === 'generaltrack' ? UNSCANNED_TRACKING : ACCEPTED_CANCEL);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };

  const deps = {
    getEnv: (key: string) => {
      envReads.push(key);
      return env[key];
    },
    readSupabaseSecretKey: () => s.secretKey ?? SECRET_KEY,
    reportMessage: async (...args: unknown[]) => {
      reports.push(args);
      if (s.reportMessageFails) throw new Error('sentry down');
    },
    createSupabaseAdmin: (...args: unknown[]) => {
      timeline.push('createSupabaseAdmin');
      supabaseClients.push(args);
      return supabase as never;
    },
    createStripe: () => {
      timeline.push('createStripe');
      stripeClients += 1;
      return stripe as never;
    },
    fetch: fakeFetch as unknown as typeof fetch,
    now: () => clock,
    randomUUID: () => 'run-1',
    sleep: async (ms: number) => {
      timeline.push('sleep');
      sleeps.push(ms);
      clock += s.sleepAdvanceMs ?? ms;
    },
  };
  const handler = paid
    ? createAutoCancelOrdersHandler(deps)
    : createAutoCancelPreparingHandler(deps);
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: s.headers ?? { 'x-cron-secret': CRON_SECRET },
    }),
  );
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const logs = consoleLines.slice(logStart);
  const loopFailure = logs.find((entry) =>
    String(entry.msg).startsWith('Excepción en loop'),
  );
  return {
    response,
    text,
    body: body as Row,
    count: (body as Row | undefined)?.success,
    error: loopFailure?.error as string | undefined,
    events: timeline.filter((entry) => !RUN_LEVEL.has(entry)),
    timeline,
    rpcCalls,
    queries,
    shipmentQueries: queries
      .filter((query) => query.table === 'shipments')
      .map((query) => query.calls),
    refunds,
    completions,
    recordings,
    listed,
    retrieved,
    escalations,
    charges,
    reports,
    critical: logs.filter((entry) => entry.level === 'CRITICAL'),
    fetches,
    sleeps,
    envReads,
    supabaseClients,
    stripeClients: () => stripeClients,
    logs,
  };
}

for (const name of ['auto-cancel-orders', 'auto-cancel-preparing'] as const) {
  const paid = name === 'auto-cancel-orders';
  const job = paid ? 'auto_cancel_orders' : 'auto_cancel_preparing';
  const column = paid ? 'order_expiration_hours' : 'preparing_expiration_hours';
  const timestampColumn = paid ? 'created_at' : 'updated_at';
  const expectedSource = paid ? 'paid_timeout' : 'preparing_timeout';
  const reason80 = paid
    ? 'Cancelación automática: Excedió el límite de 80 horas para envío.'
    : 'Cancelación automática: Envío en preparación por más de 80 horas sin escaneo del carrier.';
  const successMsg = paid
    ? 'Shipment cancelado exitosamente'
    : 'Shipment en preparing cancelado exitosamente';
  const run = (s: Scenario = {}) => runCron(name, s);
  const candidate = (id: string, extra: Row = {}): Row => ({
    id,
    order_id: `o-${id}`,
    seller_id: 'seller',
    stripe_payment_intent_id: null,
    status: paid ? 'paid' : 'preparing',
    stripe_transfer_id: null,
    ...(paid ? {} : { tracking_number: 'TRK-9', carrier: 'estafeta' }),
    ...extra,
  });

  describe(`${name} cron authentication`, () => {
    for (const [label, headers] of [
      ['no secret', {}],
      ['a wrong secret', { 'x-cron-secret': 'not-the-secret' }],
      [
        'only an Authorization bearer',
        { Authorization: `Bearer ${CRON_SECRET}` },
      ],
    ] as const)
      test(`${label} returns 401 UNAUTHORIZED before any client, lease, table or Stripe call`, async () => {
        const result = await run({ headers: { ...headers } });
        expect(result.response.status).toBe(401);
        expect(result.response.headers.get('Content-Type')).toBe(
          'application/json',
        );
        expect(result.text).toBe('{"error":"UNAUTHORIZED"}');
        expect(result.timeline).toEqual([]);
        expect(result.supabaseClients).toEqual([]);
        expect(result.stripeClients()).toBe(0);
      });
    test('an unset CRON_SECRET fails closed, even for an empty header', async () => {
      const result = await run({
        env: { CRON_SECRET: undefined },
        headers: { 'x-cron-secret': '' },
      });
      expect(result.response.status).toBe(401);
      expect(result.timeline).toEqual([]);
    });
    test('a wrong non-empty secret sends one Sentry message and still returns the plain 401', async () => {
      const result = await run({
        headers: { 'x-cron-secret': 'not-the-secret' },
      });
      expect(result.response.status).toBe(401);
      expect(result.text).toBe('{"error":"UNAUTHORIZED"}');
      expect(result.reports).toEqual([
        [
          `${name} cron secret mismatch`,
          {
            fingerprint: ['cron-secret-mismatch', name],
            tags: { edge_function: name },
          },
        ],
      ]);
      expect(JSON.stringify(result.reports)).not.toContain('not-the-secret');
    });
    for (const [label, headers] of [
      ['no header', {}],
      ['only an Authorization bearer', { Authorization: 'Bearer x' }],
    ] as const)
      test(`${label} returns the 401 without a Sentry message`, async () => {
        const result = await run({ headers: { ...headers } });
        expect(result.response.status).toBe(401);
        expect(result.reports).toEqual([]);
      });
    test('a failing Sentry report never changes the 401', async () => {
      const result = await run({
        headers: { 'x-cron-secret': 'wrong' },
        reportMessageFails: true,
      });
      expect(result.response.status).toBe(401);
      expect(result.text).toBe('{"error":"UNAUTHORIZED"}');
      expect(result.reports).toHaveLength(1);
    });
    test('the right secret builds one Supabase client from SUPABASE_URL and the secret key, and one Stripe client', async () => {
      const result = await run({ candidates: [] });
      expect(result.response.status).toBe(200);
      expect(result.supabaseClients).toEqual([[SUPABASE_URL, SECRET_KEY]]);
      expect(result.stripeClients()).toBe(1);
      expect(result.timeline.slice(0, 3)).toEqual([
        'createSupabaseAdmin',
        'createStripe',
        'fn_acquire_cron_lease',
      ]);
    });
  });

  describe(`${name} run lease`, () => {
    test('claims the lease for its job before any work and releases it last', async () => {
      const result = await run();
      expect(result.response.status).toBe(200);
      const leaseCalls = result.rpcCalls.filter(([rpc]) =>
        rpc.includes('cron_lease'),
      );
      expect(leaseCalls).toEqual([
        ['fn_acquire_cron_lease', { p_job: job }],
        ['fn_release_cron_lease', { p_job: job, p_lease_id: 'lease-1' }],
      ]);
      const work = result.timeline.filter(
        (entry) => entry !== 'createSupabaseAdmin' && entry !== 'createStripe',
      );
      expect(work[0]).toBe('fn_acquire_cron_lease');
      expect(work.at(-1)).toBe('fn_release_cron_lease');
    });
    test('a lease held by another run returns its 200 without reading settings or shipments, and releases nothing', async () => {
      const result = await run({
        lease: { data: [{ acquired: false, lease_id: null }], error: null },
      });
      expect(result.response.status).toBe(200);
      expect(result.body).toEqual({ message: 'Already running' });
      expect(result.timeline).toEqual([
        'createSupabaseAdmin',
        'createStripe',
        'fn_acquire_cron_lease',
      ]);
    });
    test('an unreadable lease returns 500 INTERNAL_ERROR with no work and no release', async () => {
      const result = await run({
        lease: { data: null, error: { message: 'lease down', code: 'X' } },
      });
      expect(result.response.status).toBe(500);
      expect(result.text).toBe('{"error":"INTERNAL_ERROR"}');
      expect(result.timeline).toEqual([
        'createSupabaseAdmin',
        'createStripe',
        'fn_acquire_cron_lease',
      ]);
    });
    test('a top-level failure returns a stable INTERNAL_ERROR, logs the raw error and still releases the lease', async () => {
      const result = await run({ settings: 'throw' });
      expect(result.response.status).toBe(500);
      expect(result.text).toBe('{"error":"INTERNAL_ERROR"}');
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: `Fallo crítico en ${name}`,
          error: 'secret db detail',
        }),
      );
      expect(result.timeline.at(-1)).toBe('fn_release_cron_lease');
      expect(result.rpcCalls.at(-1)).toEqual([
        'fn_release_cron_lease',
        { p_job: job, p_lease_id: 'lease-1' },
      ]);
    });
    test('a failed candidate query is a top-level failure that releases the lease', async () => {
      const result = await run({ candidatesError: { message: 'boom' } });
      expect(result.response.status).toBe(500);
      expect(result.text).toBe('{"error":"INTERNAL_ERROR"}');
      expect(result.refunds).toEqual([]);
      expect(result.timeline.at(-1)).toBe('fn_release_cron_lease');
    });
    test('a run budget exceeded after the first candidate defers the rest, unclaimed, and reports it', async () => {
      const result = await run({
        candidates: ['s1', 's2', 's3'].map((id) => candidate(id)),
        status: 'busy',
        sleepAdvanceMs: 100_000,
      });
      expect(result.response.status).toBe(200);
      // Only the paid job writes label deadline reminders (expo-push-notifications T7).
      expect(result.body).toEqual(
        paid
          ? { processed: 1, success: 0, deferred: 2, reminded: 2 }
          : { processed: 1, success: 0, deferred: 2 },
      );
      expect(
        result.rpcCalls
          .filter(([rpc]) => rpc === 'fn_claim_shipment_cancellation')
          .map(([, args]) => args.p_shipment_id),
      ).toEqual(['s1']);
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'WARN',
          msg: 'Auto-cancel run budget reached; remaining shipments wait for the next run',
          deferred: 2,
        }),
      );
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          msg: paid
            ? 'Proceso finalizado'
            : 'Proceso de auto-cancelación de preparing finalizado',
          total: 3,
          deferred: 2,
          success: 0,
        }),
      );
      expect(result.timeline.at(-1)).toBe('fn_release_cron_lease');
    });
    test('pauses 500 ms after each processed shipment', async () => {
      const result = await run({
        candidates: [candidate('s1'), candidate('s2')],
        status: 'busy',
      });
      expect(result.sleeps).toEqual([500, 500]);
      const claims = result.timeline
        .map((entry, index) => [entry, index] as const)
        .filter(([entry]) => entry === 'fn_claim_shipment_cancellation')
        .map(([, index]) => index);
      expect(result.timeline.indexOf('sleep')).toBeGreaterThan(claims[0]!);
      expect(result.timeline.indexOf('sleep')).toBeLessThan(claims[1]!);
    });
  });

  describe(`${name} settings and candidates`, () => {
    for (const [label, settings] of [
      ['null', { data: { [column]: null } }],
      ['0', { data: { [column]: 0 } }],
      ['-1', { data: { [column]: -1 } }],
      ['1.5', { data: { [column]: 1.5 } }],
      ['a missing row', { data: null }],
      ['a read error', { data: null, error: { message: 'boom' } }],
    ] as const)
      test(`an invalid ${column} (${label}) returns 500 AUTO_CANCEL_SETTINGS_INVALID, never queries shipments and releases the lease`, async () => {
        const result = await run({ settings });
        expect(result.response.status).toBe(500);
        expect(result.text).toBe('{"error":"AUTO_CANCEL_SETTINGS_INVALID"}');
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'ERROR',
            msg: 'Auto-cancel settings invalid',
            setting: column,
          }),
        );
        expect(result.timeline).not.toContain('shipments');
        expect(result.timeline).not.toContain(
          'fn_notify_label_deadline_reminders',
        );
        expect(result.timeline.at(-1)).toBe('fn_release_cron_lease');
      });
    test(`reads only ${column} from system_settings, after the lease`, async () => {
      const result = await run({ candidates: [] });
      expect(
        result.queries.filter((query) => query.table === 'system_settings'),
      ).toEqual([
        { table: 'system_settings', calls: [['select', column], ['single']] },
      ]);
      expect(result.timeline.indexOf('system_settings')).toBeGreaterThan(
        result.timeline.indexOf('fn_acquire_cron_lease'),
      );
    });
    test(`a valid ${column} sets the limit from the clock and selects candidates oldest first`, async () => {
      const result = await run({ hours: 5, candidates: [] });
      expect(result.response.status).toBe(200);
      const candidateQuery = result.shipmentQueries.find(
        (calls) => !calls.some(([method]) => method === 'not'),
      )!;
      const limit = new Date(START - 5 * 3600 * 1000).toISOString();
      expect(candidateQuery).toEqual(
        paid
          ? [
              [
                'select',
                'id, order_id, seller_id, stripe_payment_intent_id, status, stripe_transfer_id',
              ],
              ['eq', 'status', 'paid'],
              ['is', 'tracking_number', null],
              ['lt', 'created_at', limit],
              [
                'in',
                'label_generation_state',
                ['unclaimed', 'retryable_rejected'],
              ],
              ['order', 'created_at', { ascending: true }],
              ['limit', 50],
            ]
          : [
              [
                'select',
                'id, order_id, seller_id, stripe_payment_intent_id, status, stripe_transfer_id, tracking_number, carrier',
              ],
              ['eq', 'status', 'preparing'],
              ['lt', 'updated_at', limit],
              ['order', 'updated_at', { ascending: true }],
              ['limit', 50],
            ],
      );
      expect(candidateQuery.find(([method]) => method === 'lt')![1]).toBe(
        timestampColumn,
      );
    });
    test('no candidates answers 200 with its message and does no shipment work', async () => {
      const result = await run({ candidates: [] });
      expect(result.response.status).toBe(200);
      expect(result.body).toEqual(
        paid
          ? { message: 'No shipments to cancel', reminded: 2 }
          : { message: 'No preparing shipments to cancel' },
      );
      expect(result.events).toEqual([]);
      expect(result.timeline.at(-1)).toBe('fn_release_cron_lease');
    });
  });

  describe(`${name} per-shipment cancellation`, () => {
    test('claims before reconstruction; second target uses order PI and uncapped sibling loss weights', async () => {
      const result = await run();
      expect(result.error).toBeUndefined();
      expect(result.count).toBe(1);
      expect(result.events[0]).toBe('fn_claim_shipment_cancellation');
      expect(
        result.rpcCalls.find(
          ([rpc]) => rpc === 'fn_claim_shipment_cancellation',
        ),
      ).toEqual([
        'fn_claim_shipment_cancellation',
        {
          p_shipment_id: 'target',
          p_order_id: 'order',
          p_actor_id: null,
          p_source: expectedSource,
          p_reason: reason80,
        },
      ]);
      expect(result.charges).toEqual([
        ['ch', { expand: ['balance_transaction'] }],
      ]);
      const refundRequest = {
        payment_intent: 'pi_order',
        amount: 339326,
        reason: 'requested_by_customer',
        metadata: {
          shipment_id: 'target',
          order_id: 'order',
          caller_role: 'system',
          reason: reason80,
          seguro_share_cents: 14326,
        },
      };
      expect(
        result.rpcCalls.find(
          ([rpc]) => rpc === 'fn_start_shipment_cancellation_refund',
        ),
      ).toEqual([
        'fn_start_shipment_cancellation_refund',
        {
          p_shipment_id: 'target',
          p_claim_token: 'token',
          p_refund_request: refundRequest,
          p_cancellation_loss_cents: 14326,
        },
      ]);
      expect(result.refunds).toEqual([
        [refundRequest, { idempotencyKey: 'cancel_shipment_target' }],
      ]);
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
      expect(result.completions).toEqual([
        {
          p_shipment_id: 'target',
          p_cancelled_by_role: 'system',
          p_reason: reason80,
          p_cancellation_loss_cents: 14326,
        },
      ]);
      const at = (entry: string) => result.events.indexOf(entry);
      expect(at('fn_start_shipment_cancellation_refund')).toBeGreaterThan(
        at('fn_claim_shipment_cancellation'),
      );
      expect(at('refund')).toBeGreaterThan(
        at('fn_start_shipment_cancellation_refund'),
      );
      expect(at('fn_record_shipment_cancellation_refund')).toBeGreaterThan(
        at('refund'),
      );
      expect(at('fn_cancel_shipment')).toBeGreaterThan(
        at('fn_record_shipment_cancellation_refund'),
      );
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'INFO',
          msg: successMsg,
          shipmentId: 'target',
          orderId: 'order',
          refundAmountCents: 339326,
        }),
      );
      expect(result.body).toEqual(
        paid
          ? { processed: 1, success: 1, deferred: 0, reminded: 2 }
          : { processed: 1, success: 1, deferred: 0 },
      );
    });
    test('an unreconciled order fee is read from the Stripe charge, persisted only while unset, and drives the loss', async () => {
      const result = await run({ feeCents: null, balanceFeeCents: 31959 });
      expect(result.count).toBe(1);
      const update = result.queries.find(
        (query) =>
          query.table === 'orders' &&
          query.calls.some(([method]) => method === 'update'),
      );
      const reconciledAt = new Date(START).toISOString();
      expect(update?.calls).toEqual([
        [
          'update',
          {
            actual_stripe_fee_cents: 31959,
            stripe_fee_reconciled_at: reconciledAt,
            updated_at: reconciledAt,
          },
        ],
        ['eq', 'id', 'order'],
        ['is', 'actual_stripe_fee_cents', null],
      ]);
      expect(result.completions[0]).toMatchObject({
        p_cancellation_loss_cents: 14326,
      });
    });
    test('a failed fee write only warns and the cancellation continues', async () => {
      const result = await run({
        feeCents: null,
        balanceFeeCents: 31959,
        feeUpdateError: { message: 'fee write failed' },
      });
      expect(result.count).toBe(1);
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'WARN',
          msg: 'Could not persist on-demand Stripe fee reconciliation',
          shipmentId: 'target',
          error: 'fee write failed',
        }),
      );
    });
    test('without a Stripe fee the loss is null and the order is not written', async () => {
      const result = await run({ feeCents: null });
      expect(result.count).toBe(1);
      expect(
        result.queries.some((query) =>
          query.calls.some(([method]) => method === 'update'),
        ),
      ).toBe(false);
      expect(result.completions[0]).toMatchObject({
        p_cancellation_loss_cents: null,
      });
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'WARN',
          msg: 'Stripe fee reconciliation unavailable during auto-cancel',
          chargeId: 'ch',
        }),
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
    test('concurrent and repeated runs do not issue another refund', async () => {
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
        {
          p_shipment_id: 'target',
          p_cancelled_by_role: 'system',
          p_reason: 'Stored reason',
          p_cancellation_loss_cents: 14326,
        },
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
      expect(result.refunds[0]![0]).toMatchObject({
        payment_intent: 'pi_shipment',
        amount: 339326,
      });
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
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'WARN',
          msg: 'Shipment cancellation skipped',
          shipmentId: 'target',
          status: 'busy',
        }),
      );
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
        {
          p_shipment_id: 'target',
          p_cancelled_by_role: 'seller',
          p_reason: 'Original reason',
          p_cancellation_loss_cents: 14326,
        },
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
      expect(result.error).toContain('CANCELLATION_REFUND_UNCONFIRMED');
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
      expect(result.refunds[0]![1]).toEqual({
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
      expect(result.error).toBe('CANCELLATION_RECOVERY_UNAVAILABLE');
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: 'Cancellation recovery lookup failed',
          shipmentId: 'target',
          error: 'recovery rpc secret',
        }),
      );
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
    ] as const)(
      'a Stripe %s failure surfaces CANCELLATION_REFUND_LOOKUP_FAILED, logs the Stripe text and creates nothing',
      async (action, options, raw) => {
        const result = await run({ status: 'recovery_required', ...options });
        expect(result.error).toBe('CANCELLATION_REFUND_LOOKUP_FAILED');
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'ERROR',
            msg: 'Stripe refund lookup failed',
            shipmentId: 'target',
            action,
            error: raw,
          }),
        );
        expect(result.refunds).toEqual([]);
        expect(result.completions).toEqual([]);
      },
    );
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
      expect(result.critical[0]!.msg).toBe('CANCELLATION_REFUND_NOT_FOUND');
      expect(result.reports).toEqual([
        [
          `${name} CANCELLATION_REFUND_NOT_FOUND`,
          {
            fingerprint: [
              'shipment-cancellation',
              name,
              'CANCELLATION_REFUND_NOT_FOUND',
            ],
            tags: { edge_function: name, shipment_id: 'target' },
          },
        ],
      ]);
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
      expect(result.reports).toEqual([]);
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
      expect(result.logs).toContainEqual(
        expect.objectContaining({
          level: 'ERROR',
          msg: 'Cancellation escalation failed',
          shipmentId: 'target',
          error: 'escalate secret detail',
        }),
      );
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
    });
    test('a database cancellation failure after a recorded refund is reported as critical and still fails the shipment', async () => {
      const result = await run({ rpcErrorAt: 'fn_cancel_shipment' });
      expect(result.error).toBe('SHIPMENT_LABEL_OPERATION_ACTIVE');
      expect(result.count).toBe(0);
      expect(result.critical).toEqual([
        expect.objectContaining({
          msg: 'Refund succeeded but database cancellation failed; manual review required',
          shipmentId: 'target',
          error: 'SHIPMENT_LABEL_OPERATION_ACTIVE',
        }),
      ]);
      expect(result.reports).toEqual([
        [
          `${name} Refund succeeded but database cancellation failed; manual review required`,
          {
            fingerprint: [
              'shipment-cancellation',
              name,
              'Refund succeeded but database cancellation failed; manual review required',
            ],
            tags: { edge_function: name, shipment_id: 'target' },
          },
        ],
      ]);
      expect(result.refunds).toHaveLength(1);
    });
    for (const rpcErrorAt of [
      'fn_claim_shipment_cancellation',
      'fn_start_shipment_cancellation_refund',
    ])
      test(`${rpcErrorAt} rejection surfaces its SQL reason without effects`, async () => {
        const result = await run({ rpcErrorAt });
        expect(result.error).toBe('SHIPMENT_LABEL_OPERATION_ACTIVE');
        expect(result.refunds).toEqual([]);
        expect(result.completions).toEqual([]);
        expect(result.count).toBe(0);
        expect(result.response.status).toBe(200);
      });
    test('failed start cannot refund or cancel', async () => {
      const result = await run({ failStart: true });
      expect(result.error).toContain('start denied');
      expect(result.refunds).toEqual([]);
      expect(result.completions).toEqual([]);
    });
    for (const [options, code] of [
      [{ missingPI: true }, 'AUTO_CANCEL_MISSING_PAYMENT_INTENT'],
      [{ invalid: true }, undefined],
      // This order's fee shares round to the exact fee, so even one missing cent is not rounding.
      [{ remaining: 339325 }, undefined],
    ] as const)
      test(`invalid basis cannot start: ${JSON.stringify(options)}`, async () => {
        const result = await run({ ...options });
        expect(result.error).toBeDefined();
        if (code) expect(result.error).toBe(code);
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
        expect(result.count).toBe(0);
      });
  });

  if (paid) {
    describe(`${name} takeover and paid-only wiring`, () => {
      for (const source of ['buyer', 'seller'])
        test(`takeover preserves ${source} context`, async () => {
          const result = await run({ source });
          expect(result.error).toBeUndefined();
          expect(result.completions[0]).toMatchObject({
            p_cancelled_by_role: source,
            p_reason: 'Original reason',
          });
          expect(result.refunds[0]![0]).toMatchObject({
            metadata: { caller_role: source, reason: 'Original reason' },
          });
        });
      test('never resolves Envia or asks the carrier', async () => {
        const result = await run();
        expect(result.count).toBe(1);
        expect(result.envReads).not.toContain('ENVIA_MODE');
        expect(result.fetches).toEqual([]);
        expect(
          result.rpcCalls.filter(([rpc]) => rpc.includes('carrier')),
        ).toEqual([]);
      });
    });

    describe(`${name} label deadline reminders`, () => {
      test('calls the reminder RPC once, inside the lease, after the settings read and before any candidate query', async () => {
        const result = await run();
        const at = (entry: string) => result.timeline.indexOf(entry);
        expect(
          result.rpcCalls.filter(
            ([rpc]) => rpc === 'fn_notify_label_deadline_reminders',
          ),
        ).toEqual([['fn_notify_label_deadline_reminders', {}]]);
        expect(at('fn_notify_label_deadline_reminders')).toBeGreaterThan(
          at('system_settings'),
        );
        expect(at('system_settings')).toBeGreaterThan(
          at('fn_acquire_cron_lease'),
        );
        expect(at('shipments')).toBeGreaterThan(
          at('fn_notify_label_deadline_reminders'),
        );
      });
      test('a failing reminder call only logs and the run continues with reminded 0', async () => {
        const result = await run({
          reminders: { data: null, error: { message: 'reminder down' } },
        });
        expect(result.response.status).toBe(200);
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'ERROR',
            msg: 'Label deadline reminders failed',
            error: 'reminder down',
          }),
        );
        expect(result.body).toEqual({
          processed: 1,
          success: 1,
          deferred: 0,
          reminded: 0,
        });
      });
      test('a successful reminder call reports its count in both replies', async () => {
        const empty = await run({
          candidates: [],
          reminders: { data: 3, error: null },
        });
        expect(empty.body).toEqual({
          message: 'No shipments to cancel',
          reminded: 3,
        });
        const full = await run({ reminders: { data: 3, error: null } });
        expect(full.body).toMatchObject({ reminded: 3 });
        expect(full.logs).toContainEqual(
          expect.objectContaining({
            level: 'INFO',
            msg: 'Label deadline reminders written',
            reminded: 3,
          }),
        );
      });
    });

    describe(`${name} blocked shipment report`, () => {
      const blockedWarn =
        'Expired paid shipments blocked by a label operation; manual review required';
      test('blocked expired shipments are reported once for manual review with the exact report query', async () => {
        const result = await run({
          hours: 5,
          candidates: [],
          report: { data: [{ id: 's1' }, { id: 's2' }], error: null },
        });
        expect(result.response.status).toBe(200);
        const warns = result.logs.filter((entry) => entry.msg === blockedWarn);
        expect(warns).toEqual([
          expect.objectContaining({ level: 'WARN', shipmentIds: ['s1', 's2'] }),
        ]);
        const reportQuery = result.shipmentQueries.find((calls) =>
          calls.some(([method]) => method === 'not'),
        );
        expect(reportQuery).toEqual([
          ['select', 'id'],
          ['eq', 'status', 'paid'],
          ['is', 'tracking_number', null],
          ['lt', 'created_at', new Date(START - 5 * 3600 * 1000).toISOString()],
          [
            'not',
            'label_generation_state',
            'in',
            '(unclaimed,retryable_rejected)',
          ],
          ['order', 'created_at', { ascending: true }],
          ['limit', 50],
        ]);
        // The report never claims what it reports.
        expect(result.events).toEqual([]);
      });
      test('no blocked shipments means no review warning', async () => {
        const result = await run({ candidates: [] });
        expect(result.response.status).toBe(200);
        expect(
          result.logs.filter((entry) => entry.msg === blockedWarn),
        ).toEqual([]);
      });
      test('a report read error is logged by message and never blocks the candidate query', async () => {
        const result = await run({
          report: { data: null, error: { message: 'boom' } },
        });
        expect(result.response.status).toBe(200);
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'ERROR',
            msg: 'Blocked paid shipment report failed',
            error: 'boom',
          }),
        );
        expect(
          result.logs.filter((entry) => entry.msg === blockedWarn),
        ).toEqual([]);
        expect(result.count).toBe(1);
      });
    });
  } else {
    describe(`${name} carrier gate`, () => {
      const noFinancialWork = (result: Awaited<ReturnType<typeof run>>) => {
        expect(result.refunds).toEqual([]);
        expect(result.completions).toEqual([]);
        expect(result.recordings).toEqual([]);
        expect(result.events).not.toContain('order_items');
        expect(result.events).not.toContain(
          'fn_start_shipment_cancellation_refund',
        );
      };
      test('asks the carrier gate with the shipment and the claim token before any reconstruction', async () => {
        const result = await run();
        expect(result.count).toBe(1);
        expect(result.events.slice(0, 3)).toEqual([
          'fn_claim_shipment_cancellation',
          'fn_get_shipment_carrier_cancellation',
          'order_items',
        ]);
        expect(
          result.rpcCalls.find(
            ([rpc]) => rpc === 'fn_get_shipment_carrier_cancellation',
          ),
        ).toEqual([
          'fn_get_shipment_carrier_cancellation',
          { p_shipment_id: 'target' },
        ]);
      });
      test('an unscanned label is cancelled with the carrier and recorded before the refund', async () => {
        const result = await run({ carrierState: {} });
        expect(result.count).toBe(1);
        expect(result.fetches).toEqual([
          {
            url: 'https://envia.test/ship/generaltrack/',
            authorization: `Bearer ${ENVIA_KEY}`,
            body: { trackingNumbers: ['TRK-9'] },
          },
          {
            url: 'https://envia.test/ship/cancel/',
            authorization: `Bearer ${ENVIA_KEY}`,
            body: { carrier: 'estafeta', trackingNumber: 'TRK-9' },
          },
        ]);
        expect(
          result.rpcCalls.find(
            ([rpc]) => rpc === 'fn_record_shipment_carrier_cancellation',
          ),
        ).toEqual([
          'fn_record_shipment_carrier_cancellation',
          {
            p_shipment_id: 'target',
            p_claim_token: 'token',
            p_outcome: 'accepted',
            p_balance_returned: true,
            p_balance_returned_at: '2026-10-23T11:00:00.000Z',
          },
        ]);
        expect(result.events.slice(0, 5)).toEqual([
          'fn_claim_shipment_cancellation',
          'fn_get_shipment_carrier_cancellation',
          'envia:generaltrack',
          'envia:cancel',
          'fn_record_shipment_carrier_cancellation',
        ]);
        expect(result.events.indexOf('refund')).toBeGreaterThan(
          result.events.indexOf('fn_record_shipment_carrier_cancellation'),
        );
        expect(JSON.stringify(result.logs)).not.toContain(ENVIA_KEY);
      });
      test('a refused label cancellation marks the shipment for review with the claim token and alerts once', async () => {
        const result = await run({
          carrierState: {},
          cancel: [
            {
              status: 422,
              body: { meta: 'error', error: { code: 1115 } },
            },
          ],
        });
        expect(result.count).toBe(0);
        expect(
          result.rpcCalls.find(
            ([rpc]) => rpc === 'fn_mark_shipment_cancellation_review',
          ),
        ).toEqual([
          'fn_mark_shipment_cancellation_review',
          {
            p_shipment_id: 'target',
            p_claim_token: 'token',
            p_reason: 'carrier_refused',
          },
        ]);
        expect(result.reports).toEqual([
          [
            `${name} Preparing cancellation needs carrier review; no refund was made`,
            expect.objectContaining({
              tags: { edge_function: name, shipment_id: 'target' },
            }),
          ],
        ]);
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'WARN',
            msg: 'Shipment cancellation waiting on carrier evidence',
            shipmentId: 'target',
            reason: 'carrier_refused',
          }),
        );
        noFinancialWork(result);
        expect(JSON.stringify(result.logs)).not.toContain('"token"');
      });
      test('a scanned label records the tracking event with the run id and the clock, and stops', async () => {
        const result = await run({
          carrierState: {},
          tracking: [
            {
              status: 200,
              body: {
                data: [
                  {
                    trackingNumber: 'TRK-9',
                    status: 'Picked up',
                    date: '2026-10-22T10:00:00.000Z',
                    location: 'CDMX',
                    carrierName: 'Estafeta',
                  },
                ],
              },
            },
          ],
        });
        const event = result.rpcCalls.find(
          ([rpc]) => rpc === 'fn_record_tracking_event',
        );
        expect(event?.[1]).toMatchObject({
          p_shipment_id: 'target',
          p_dispute_id: null,
          p_event_type: 'in_transit',
          p_raw_status: 'Picked up',
          p_location: 'CDMX',
          p_carrier_name: 'Estafeta',
          p_webhook_delivery_id: null,
          p_polling_run_id: 'run-1',
          p_transition: 'shipped',
        });
        expect(result.fetches).toHaveLength(1);
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'WARN',
            reason: 'tracking_advanced',
          }),
        );
        noFinancialWork(result);
      });
      test('a scanned event without its own date is stamped with the injected clock', async () => {
        const result = await run({
          carrierState: {},
          tracking: [
            {
              status: 200,
              body: {
                data: [{ trackingNumber: 'TRK-9', status: 'Picked up' }],
              },
            },
          ],
        });
        const event = result.rpcCalls.find(
          ([rpc]) => rpc === 'fn_record_tracking_event',
        );
        expect(event?.[1]).toMatchObject({
          p_event_at: new Date(START).toISOString(),
        });
      });
      test('a gate stop logs a WARN with shipment id and reason and does no financial work', async () => {
        const result = await run({
          carrierState: { review_required_at: '2026-11-10T00:00:00.000Z' },
        });
        expect(result.error).toBeUndefined();
        expect(result.count).toBe(0);
        expect(result.events).toEqual([
          'fn_claim_shipment_cancellation',
          'fn_get_shipment_carrier_cancellation',
        ]);
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'WARN',
            msg: 'Shipment cancellation waiting on carrier evidence',
            shipmentId: 'target',
            reason: 'under_review',
          }),
        );
        expect(JSON.stringify(result.logs)).not.toContain('"token"');
        expect(JSON.stringify(result.logs)).not.toContain('exitosamente');
        noFinancialWork(result);
      });
      test('a gate failure reaches the loop as an ERROR with no financial work, so the shipment is retried next run', async () => {
        const result = await run({ carrierStateError: 'gate exploded' });
        expect(result.error).toBe('gate exploded');
        expect(result.events).toEqual([
          'fn_claim_shipment_cancellation',
          'fn_get_shipment_carrier_cancellation',
        ]);
        noFinancialWork(result);
      });
      for (const source of ['buyer', 'seller'])
        test(`a ${source} winner is a source_mismatch ERROR: no carrier call and no refund`, async () => {
          const result = await run({ source });
          expect(result.logs).toContainEqual(
            expect.objectContaining({
              level: 'ERROR',
              msg: 'Shipment cancellation claim has an unexpected source; no carrier call was made',
              shipmentId: 'target',
              reason: 'source_mismatch',
            }),
          );
          expect(
            result.logs.filter(
              (entry) =>
                entry.level === 'WARN' && entry.reason === 'source_mismatch',
            ),
          ).toEqual([]);
          expect(result.events).toEqual(['fn_claim_shipment_cancellation']);
          expect(result.fetches).toEqual([]);
          noFinancialWork(result);
        });
      test.each([
        ['SHIPMENT_CANCELLATION_UNDER_REVIEW'],
        ['SHIPMENT_CANCELLATION_REVIEW_CLOSED'],
      ])('a %s claim error is an INFO skip, never an ERROR', async (code) => {
        const result = await run({
          rpcErrorAt: 'fn_claim_shipment_cancellation',
          rpcErrorMessage: code,
        });
        expect(result.body).toEqual({ processed: 1, success: 0, deferred: 0 });
        expect(result.logs.filter((entry) => entry.level === 'ERROR')).toEqual(
          [],
        );
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'INFO',
            msg: 'Shipment cancellation skipped: carrier review',
            shipmentId: 'target',
            orderId: 'order',
            reason: code,
          }),
        );
      });
      test('any other claim failure is still an ERROR', async () => {
        const result = await run({
          rpcErrorAt: 'fn_claim_shipment_cancellation',
          rpcErrorMessage: 'SOMETHING_ELSE',
        });
        expect(result.logs).toContainEqual(
          expect.objectContaining({
            level: 'ERROR',
            msg: 'Excepción en loop para shipment target',
            orderId: 'order',
            error: 'SOMETHING_ELSE',
          }),
        );
      });
      test('resolves the Envia configuration once per run and gates every shipment', async () => {
        const result = await run({
          carrierState: {},
          candidates: [
            candidate('s1'),
            candidate('s2', { tracking_number: null, carrier: null }),
          ],
          status: 'claimed',
          cancel: [{ status: 422, body: { meta: 'error' } }],
        });
        expect(
          result.envReads.filter((key) => key === 'ENVIA_MODE'),
        ).toHaveLength(1);
        // s1 asks Envia (tracking, cancel, re-check); s2 has no tracking number and goes to review.
        expect(result.fetches.map((entry) => entry.url)).toEqual([
          'https://envia.test/ship/generaltrack/',
          'https://envia.test/ship/cancel/',
          'https://envia.test/ship/generaltrack/',
        ]);
        expect(
          result.rpcCalls
            .filter(([rpc]) => rpc === 'fn_mark_shipment_cancellation_review')
            .map(([, args]) => [args.p_shipment_id, args.p_reason]),
        ).toEqual([
          ['s1', 'carrier_refused'],
          ['s2', 'tracking_unknown'],
        ]);
      });
      test('missing Envia configuration logs one ERROR without secrets and makes no carrier call', async () => {
        const result = await run({
          env: { ENVIA_MODE: undefined },
          carrierState: {},
          candidates: [candidate('s1'), candidate('s2')],
        });
        const errors = result.logs.filter((entry) => entry.level === 'ERROR');
        expect(errors).toEqual([
          expect.objectContaining({
            msg: 'Envia configuration unavailable; preparing cancellations will not call the carrier',
          }),
        ]);
        expect(result.fetches).toEqual([]);
        expect(
          result.logs
            .filter((entry) => entry.reason === 'carrier_unavailable')
            .map((entry) => entry.shipmentId),
        ).toEqual(['s1', 's2']);
        expect(result.refunds).toEqual([]);
        expect(JSON.stringify(result.logs)).not.toContain(ENVIA_KEY);
      });
      test('the preparing run sends no label deadline reminders and no blocked report', async () => {
        const result = await run();
        expect(result.timeline).not.toContain(
          'fn_notify_label_deadline_reminders',
        );
        expect(result.shipmentQueries).toHaveLength(1);
        expect(JSON.stringify(result.shipmentQueries)).not.toContain(
          'label_generation_state',
        );
      });
    });
  }
}
