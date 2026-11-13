import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  createResumePendingPayoutsHandler,
  type ResumePendingPayoutsDependencies,
  type ResumePendingPayoutsStripeClient,
  type SupabaseAdminClient,
} from './handler';

// Each test drives the handler with a recording fake Supabase client and a fake Stripe client,
// so the RPC names and arguments, the queries and the Stripe calls are the observable effects.

const CRON_SECRET = 'resume-cron-secret';
const SUPABASE_URL = 'http://supabase.test';
const SUPABASE_SECRET_KEY = 'sb_secret_resume';
const STRIPE_SECRET = 'sk_test_resume';
const ACCOUNT = 'acct_seller_1';

type RpcResult = { data: unknown; error: unknown };
type QueryResult = { data: unknown; error: unknown; count?: number | null };

type Effect =
  | { rpc: string; args: unknown }
  | {
      from: string;
      select: string;
      options?: unknown;
      filters: unknown[];
      maybeSingle: boolean;
    }
  | { stripe: string; params: unknown; options: unknown };

interface Script {
  // Answers per RPC name, consumed in order; the last answer repeats.
  rpc?: Record<string, RpcResult[]>;
  query?: (query: {
    table: string;
    select: string;
    filters: unknown[];
  }) => QueryResult;
  balance?: () => Promise<unknown>;
  createPayout?: () => Promise<unknown>;
  listPayouts?: () => Promise<unknown>;
}

const run = {
  run_id: 'run-1',
  actor_id: 'admin-1',
  seller_id: 'seller-1',
  amount_cents: 12_500,
  idempotency_key: 'release-key-original',
  shipment_ids: ['shipment-1'],
  claim_token: 'claim-token-1',
  stage_version: 3,
  claim_expires_at: '2026-09-20T00:05:00.000Z',
};

const releaseRow = {
  shipment_id: 'shipment-1',
  seller_id: 'seller-1',
  status: 'completed',
  completed_at: '2026-06-21T12:00:00.000Z',
  is_eligible: false,
  ineligible_reason: 'already_released',
  order_id: 'order-1',
  release_amount_cents: 12_500,
  stripe_account_id: ACCOUNT,
  stripe_onboarding_status: 'complete',
  stripe_transfer_id: 'tr_existing',
};

const ok = (data: unknown): RpcResult => ({ data, error: null });

// The database a valid run sees: admin actor, connected account, matching release rows.
const defaultQuery: NonNullable<Script['query']> = ({ table, select }) => {
  if (table === 'profiles_private' && select === 'role')
    return { data: { role: 'admin' }, error: null };
  if (table === 'profiles_private' && select === 'stripe_account_id')
    return { data: { stripe_account_id: ACCOUNT }, error: null };
  if (table === 'admin_connect_payout_release_view')
    return { data: [releaseRow], error: null };
  if (table === 'connect_payout_run_shipments')
    return {
      data: [
        {
          id: 'mapping-1',
          run_id: 'run-1',
          shipment_id: 'shipment-1',
          net_payout: 12_500,
          status: 'pending_reconciliation',
        },
      ],
      error: null,
      count: 1,
    };
  throw new Error(`unexpected query on ${table}`);
};

function fakeClients(script: Script) {
  const effects: Effect[] = [];
  const rpcAnswers = Object.fromEntries(
    Object.entries(script.rpc ?? {}).map(([name, answers]) => [
      name,
      [...answers],
    ]),
  );

  const supabase = {
    rpc: async (name: string, args: unknown) => {
      effects.push({ rpc: name, args });
      const answers = rpcAnswers[name];
      if (!answers) throw new Error(`unexpected rpc ${name}`);
      return answers.length > 1 ? answers.shift()! : answers[0];
    },
    from: (table: string) => ({
      select: (select: string, options?: unknown) => {
        const filters: unknown[] = [];
        const settle = (maybeSingle: boolean) => {
          effects.push({
            from: table,
            select,
            ...(options === undefined ? {} : { options }),
            filters,
            maybeSingle,
          });
          return Promise.resolve(
            (script.query ?? defaultQuery)({ table, select, filters }),
          );
        };
        const query = {
          eq: (column: string, value: unknown) => {
            filters.push(['eq', column, value]);
            return query;
          },
          in: (column: string, values: unknown) => {
            filters.push(['in', column, values]);
            return query;
          },
          maybeSingle: () => settle(true),
          then: (
            resolve: (value: QueryResult) => unknown,
            reject: (reason: unknown) => unknown,
          ) => settle(false).then(resolve, reject),
        };
        return query;
      },
    }),
  };

  const stripe = {
    balance: {
      retrieve: async (params: unknown, options: unknown) => {
        effects.push({ stripe: 'balance.retrieve', params, options });
        return script.balance
          ? script.balance()
          : { available: [{ amount: 50_000, currency: 'mxn' }] };
      },
    },
    payouts: {
      create: async (params: unknown, options: unknown) => {
        effects.push({ stripe: 'payouts.create', params, options });
        return script.createPayout
          ? script.createPayout()
          : { id: 'po_1', lastResponse: { requestId: 'req_1' } };
      },
      list: async (params: unknown, options: unknown) => {
        effects.push({ stripe: 'payouts.list', params, options });
        return script.listPayouts ? script.listPayouts() : { data: [] };
      },
    },
  };

  return { effects, supabase, stripe };
}

interface InvokeOptions extends Script {
  env?: Record<string, string | undefined>;
  supabaseSecretKey?: string | undefined;
  headers?: Record<string, string>;
  method?: string;
}

async function invoke(options: InvokeOptions = {}) {
  const { effects, supabase, stripe } = fakeClients(options);
  const env: Record<string, string | undefined> = {
    CRON_SECRET,
    SUPABASE_URL,
    STRIPE_SECRET_KEY: STRIPE_SECRET,
    ...options.env,
  };
  const reports: unknown[] = [];
  const created: unknown[] = [];
  const deps: ResumePendingPayoutsDependencies = {
    getEnv: (name) => env[name],
    readSupabaseSecretKey: () =>
      'supabaseSecretKey' in options
        ? options.supabaseSecretKey
        : SUPABASE_SECRET_KEY,
    reportMessage: (message, reportOptions) => {
      reports.push([message, reportOptions]);
    },
    createSupabaseAdmin: (url, key) => {
      created.push(['supabase', url, key]);
      return supabase as unknown as SupabaseAdminClient;
    },
    createStripe: (secret) => {
      created.push(['stripe', secret]);
      return stripe as unknown as ResumePendingPayoutsStripeClient;
    },
  };

  const response = await createResumePendingPayoutsHandler(deps)(
    new Request('http://edge.test/functions/v1/resume-pending-payouts', {
      method: options.method ?? 'POST',
      headers: options.headers ?? { 'x-cron-secret': CRON_SECRET },
    }),
  );

  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: await response.json(),
    effects,
    reports,
    created,
  };
}

const emptySummary = {
  success: true,
  claimed: 0,
  resumed: 0,
  deferred: 0,
  skipped: 0,
  actionRequired: 0,
  errors: 0,
  results: [],
};

const claimArgs = { p_lease_seconds: 300 };
const reconcileClaimArgs = { p_grace_seconds: 600 };
const fence = (stageVersion: number) => ({
  p_run_id: 'run-1',
  p_claim_token: 'claim-token-1',
  p_expected_stage_version: stageVersion,
});
const actorLookup = {
  from: 'profiles_private',
  select: 'role',
  filters: [['eq', 'id', 'admin-1']],
  maybeSingle: true,
};
const accountLookup = {
  from: 'profiles_private',
  select: 'stripe_account_id',
  filters: [['eq', 'id', 'seller-1']],
  maybeSingle: true,
};
const actionabilityRpc = {
  rpc: 'fn_get_connect_account_actionability',
  args: { p_stripe_account_id: ACCOUNT },
};
const releaseRowsQuery = {
  from: 'admin_connect_payout_release_view',
  select: '*',
  filters: [['in', 'shipment_id', ['shipment-1']]],
  maybeSingle: false,
};
// After the batch, each queue is asked once more and answers with no run.
const drainedQueues = [
  { rpc: 'fn_claim_awaiting_balance_payout_run', args: claimArgs },
  { rpc: 'fn_claim_payout_create_reconciliation', args: reconcileClaimArgs },
];

let logSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('resume-pending-payouts request gate', () => {
  test.each([
    ['no x-cron-secret header', {}, []],
    [
      'a wrong x-cron-secret',
      { 'x-cron-secret': 'wrong-secret' },
      [
        [
          'resume-pending-payouts cron secret mismatch',
          {
            fingerprint: ['cron-secret-mismatch', 'resume-pending-payouts'],
            tags: { edge_function: 'resume-pending-payouts' },
          },
        ],
      ],
    ],
    ['a bearer token', { authorization: `Bearer ${CRON_SECRET}` }, []],
  ])(
    'answers 401 to %s before any client, RPC or Stripe call',
    async (_case, headers, reports) => {
      const result = await invoke({
        headers,
        rpc: { fn_claim_awaiting_balance_payout_run: [ok(null)] },
      });

      expect(result.status).toBe(401);
      expect(result.contentType).toBe('application/json');
      expect(result.body).toEqual({
        success: false,
        error: 'CRON_UNAUTHORIZED',
      });
      expect(result.reports).toEqual(reports);
      expect(result.created).toEqual([]);
      expect(result.effects).toEqual([]);
    },
  );

  test('answers 400 to a GET before any client, RPC or Stripe call', async () => {
    const result = await invoke({ method: 'GET' });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, error: 'INVALID_REQUEST' });
    expect(result.created).toEqual([]);
    expect(result.effects).toEqual([]);
  });

  test('answers 500 when CRON_SECRET is not configured, before any client', async () => {
    const result = await invoke({ env: { CRON_SECRET: undefined } });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ success: false, error: 'INTERNAL_ERROR' });
    expect(result.reports).toEqual([]);
    expect(result.created).toEqual([]);
    expect(result.effects).toEqual([]);
  });

  test.each([
    ['STRIPE_SECRET_KEY', { env: { STRIPE_SECRET_KEY: undefined } }],
    ['SUPABASE_URL', { env: { SUPABASE_URL: undefined } }],
    ['the Supabase secret key', { supabaseSecretKey: undefined }],
  ])(
    'answers 500 MISSING_SERVER_CONFIG without %s, before any client',
    async (_case, options) => {
      const result = await invoke(options);

      expect(result.status).toBe(500);
      expect(result.body).toEqual({
        success: false,
        error: 'MISSING_SERVER_CONFIG',
      });
      expect(result.created).toEqual([]);
      expect(result.effects).toEqual([]);
    },
  );

  test('builds both clients from the configuration and answers an empty batch', async () => {
    const result = await invoke({
      rpc: {
        fn_claim_awaiting_balance_payout_run: [ok(null)],
        fn_claim_payout_create_reconciliation: [ok([])],
      },
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('application/json');
    expect(result.body).toEqual(emptySummary);
    expect(result.created).toEqual([
      ['supabase', SUPABASE_URL, SUPABASE_SECRET_KEY],
      ['stripe', STRIPE_SECRET],
    ]);
    expect(result.effects).toEqual(drainedQueues);
  });
});

describe('resume-pending-payouts awaiting-balance runs', () => {
  const claimQueue = {
    fn_claim_awaiting_balance_payout_run: [ok([run]), ok(null)],
    fn_claim_payout_create_reconciliation: [ok(null)],
    fn_get_connect_account_actionability: [
      ok([{ is_actionable: true, blocked_reason: null }]),
    ],
  };

  test('creates one payout behind the write-ahead fence with DB-derived inputs', async () => {
    const result = await invoke({
      rpc: {
        ...claimQueue,
        fn_verify_payout_claim: [ok(true)],
        fn_begin_payout_create_fence: [ok(4)],
        fn_complete_payout_create_fence: [ok(true)],
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ...emptySummary,
      claimed: 1,
      resumed: 1,
      results: [{ runId: 'run-1', status: 'resumed', stripePayoutId: 'po_1' }],
    });
    expect(result.effects).toEqual([
      { rpc: 'fn_claim_awaiting_balance_payout_run', args: claimArgs },
      actorLookup,
      accountLookup,
      actionabilityRpc,
      releaseRowsQuery,
      { rpc: 'fn_verify_payout_claim', args: fence(3) },
      {
        stripe: 'balance.retrieve',
        params: {},
        options: { stripeAccount: ACCOUNT },
      },
      { rpc: 'fn_begin_payout_create_fence', args: fence(3) },
      { rpc: 'fn_verify_payout_claim', args: fence(4) },
      {
        stripe: 'payouts.create',
        params: {
          amount: 12_500,
          currency: 'mxn',
          metadata: {
            app_name: 'selene',
            run_id: 'run-1',
            seller_id: 'seller-1',
            shipment_ids: 'shipment-1',
          },
        },
        options: {
          stripeAccount: ACCOUNT,
          idempotencyKey: 'release-key-original',
        },
      },
      {
        rpc: 'fn_complete_payout_create_fence',
        args: { ...fence(4), p_stripe_payout_id: 'po_1' },
      },
      ...drainedQueues,
    ]);
  });

  test('defers an insufficient balance with the 300 second backoff and creates no payout', async () => {
    const result = await invoke({
      rpc: {
        ...claimQueue,
        fn_verify_payout_claim: [ok(true)],
        fn_defer_awaiting_balance_run: [ok(true)],
      },
      balance: async () => ({
        available: [
          { amount: 12_499, currency: 'mxn' },
          { amount: 99_999, currency: 'usd' },
        ],
      }),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ...emptySummary,
      claimed: 1,
      deferred: 1,
      results: [
        { runId: 'run-1', status: 'deferred', reason: 'insufficient_balance' },
      ],
    });
    expect(result.effects.slice(7)).toEqual([
      {
        rpc: 'fn_defer_awaiting_balance_run',
        args: { ...fence(3), p_backoff_seconds: 300 },
      },
      ...drainedQueues,
    ]);
  });

  test('releases the claim when the deferral RPC fails and reports the error', async () => {
    const result = await invoke({
      rpc: {
        ...claimQueue,
        fn_verify_payout_claim: [ok(true)],
        fn_defer_awaiting_balance_run: [
          { data: null, error: { code: 'P0001', message: 'defer broke' } },
        ],
        fn_release_payout_claim: [ok(null)],
      },
      balance: async () => ({ available: [] }),
    });

    expect(result.body.results).toEqual([
      { runId: 'run-1', status: 'error', error: 'DEFER_RPC_FAILED' },
    ]);
    expect(result.effects.slice(8)).toEqual([
      {
        rpc: 'fn_release_payout_claim',
        args: { p_run_id: 'run-1', p_claim_token: 'claim-token-1' },
      },
      ...drainedQueues,
    ]);
  });

  test('parks a run whose account is blocked before any Stripe call', async () => {
    const result = await invoke({
      rpc: {
        ...claimQueue,
        fn_get_connect_account_actionability: [
          ok({ is_actionable: false, blocked_reason: 'bank_account_errored' }),
        ],
        fn_block_payout_run_for_account_actionability: [ok(true)],
      },
    });

    expect(result.body).toEqual({
      ...emptySummary,
      claimed: 1,
      actionRequired: 1,
      results: [
        {
          runId: 'run-1',
          status: 'action_required',
          reason: 'account_not_actionable',
        },
      ],
    });
    expect(result.effects).toEqual([
      { rpc: 'fn_claim_awaiting_balance_payout_run', args: claimArgs },
      actorLookup,
      accountLookup,
      actionabilityRpc,
      {
        rpc: 'fn_block_payout_run_for_account_actionability',
        args: { ...fence(3), p_blocked_reason: 'bank_account_errored' },
      },
      ...drainedQueues,
    ]);
  });

  test('skips the actionability RPC for a seller without a connected account', async () => {
    const result = await invoke({
      rpc: {
        ...claimQueue,
        fn_transition_payout_release_stage: [ok(5)],
      },
      query: (query) =>
        query.table === 'profiles_private' &&
        query.select === 'stripe_account_id'
          ? { data: { stripe_account_id: null }, error: null }
          : query.table === 'admin_connect_payout_release_view'
            ? {
                data: [{ ...releaseRow, stripe_account_id: null }],
                error: null,
              }
            : defaultQuery(query),
    });

    expect(result.body.results).toEqual([
      {
        runId: 'run-1',
        status: 'action_required',
        reason: 'run_shape_invalid',
      },
    ]);
    expect(result.effects).toEqual([
      { rpc: 'fn_claim_awaiting_balance_payout_run', args: claimArgs },
      actorLookup,
      accountLookup,
      releaseRowsQuery,
      {
        rpc: 'fn_transition_payout_release_stage',
        args: {
          p_run_id: 'run-1',
          p_target_stage: 'action_required',
          p_expected_stage_version: 3,
          p_claim_token: 'claim-token-1',
          p_last_error: 'CONNECT_ACCOUNT_NOT_READY',
        },
      },
      ...drainedQueues,
    ]);
  });

  test('parks a drifted run through the guarded stage transition without Stripe', async () => {
    const result = await invoke({
      rpc: { ...claimQueue, fn_transition_payout_release_stage: [ok(5)] },
      query: (query) =>
        query.table === 'admin_connect_payout_release_view'
          ? {
              data: [
                {
                  ...releaseRow,
                  is_eligible: false,
                  ineligible_reason: 'active_dispute',
                },
              ],
              error: null,
            }
          : defaultQuery(query),
    });

    expect(result.body.actionRequired).toBe(1);
    expect(result.effects.slice(5)).toEqual([
      {
        rpc: 'fn_transition_payout_release_stage',
        args: {
          p_run_id: 'run-1',
          p_target_stage: 'action_required',
          p_expected_stage_version: 3,
          p_claim_token: 'claim-token-1',
          p_last_error: 'RUN_SHAPE_INVALID',
        },
      },
      ...drainedQueues,
    ]);
  });

  test('records a definitive Stripe rejection through the fence exit and releases the claim', async () => {
    const result = await invoke({
      rpc: {
        ...claimQueue,
        fn_verify_payout_claim: [ok(true)],
        fn_begin_payout_create_fence: [ok(4)],
        fn_fail_payout_create_from_fence: [ok(true)],
        fn_release_payout_claim: [ok(null)],
      },
      createPayout: async () => {
        throw Object.assign(new Error('Invalid bank account'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
        });
      },
    });

    expect(result.body.results).toEqual([
      { runId: 'run-1', status: 'error', error: 'Invalid bank account' },
    ]);
    expect(result.effects.slice(10)).toEqual([
      {
        rpc: 'fn_fail_payout_create_from_fence',
        args: { ...fence(4), p_failure_reason: 'Invalid bank account' },
      },
      {
        rpc: 'fn_release_payout_claim',
        args: { p_run_id: 'run-1', p_claim_token: 'claim-token-1' },
      },
      ...drainedQueues,
    ]);
  });

  test('skips an actor who is no longer an admin and releases the claim', async () => {
    const result = await invoke({
      rpc: { ...claimQueue, fn_release_payout_claim: [ok(null)] },
      query: (query) =>
        query.select === 'role'
          ? { data: { role: 'user' }, error: null }
          : defaultQuery(query),
    });

    expect(result.body.results).toEqual([
      { runId: 'run-1', status: 'skipped', reason: 'actor_not_admin' },
    ]);
    expect(result.effects).toEqual([
      { rpc: 'fn_claim_awaiting_balance_payout_run', args: claimArgs },
      actorLookup,
      {
        rpc: 'fn_release_payout_claim',
        args: { p_run_id: 'run-1', p_claim_token: 'claim-token-1' },
      },
      ...drainedQueues,
    ]);
  });

  test.each([
    ['the actor lookup', 'role', 'PROFILE_LOOKUP_FAILED'],
    ['the account lookup', 'stripe_account_id', 'PROFILE_LOOKUP_FAILED'],
    ['the release rows', '*', 'RELEASE_VIEW_FAILED'],
  ])(
    'maps a failed query on %s to its error code',
    async (_case, failingSelect, code) => {
      const result = await invoke({
        rpc: { ...claimQueue, fn_release_payout_claim: [ok(null)] },
        query: (query) =>
          query.select === failingSelect
            ? { data: null, error: { code: 'XX000', message: 'db down' } }
            : defaultQuery(query),
      });

      expect(result.status).toBe(200);
      expect(result.body.results).toEqual([
        { runId: 'run-1', status: 'error', error: code },
      ]);
    },
  );

  test('maps a failed actionability RPC to its error code', async () => {
    const result = await invoke({
      rpc: {
        ...claimQueue,
        fn_get_connect_account_actionability: [
          { data: null, error: { message: 'boom' } },
        ],
        fn_release_payout_claim: [ok(null)],
      },
    });

    expect(result.body.results).toEqual([
      {
        runId: 'run-1',
        status: 'error',
        error: 'ACCOUNT_ACTIONABILITY_LOOKUP_FAILED',
      },
    ]);
  });
});

describe('resume-pending-payouts RPC errors', () => {
  test.each([
    [{ code: 'P0001', message: 'claim broke' }, 'P0001 claim broke'],
    [{ message: 'claim broke' }, 'claim broke'],
    [{ message: '' }, 'CLAIM_RPC_FAILED'],
  ])('answers 500 with the RPC error text for %j', async (error, message) => {
    const result = await invoke({
      rpc: { fn_claim_awaiting_balance_payout_run: [{ data: null, error }] },
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ success: false, error: message });
    expect(result.effects).toEqual([
      { rpc: 'fn_claim_awaiting_balance_payout_run', args: claimArgs },
    ]);
  });
});

describe('resume-pending-payouts reconciliation of fenced runs', () => {
  const reconciliationClaim = {
    run_id: 'run-1',
    actor_id: 'admin-1',
    seller_id: 'seller-1',
    amount_cents: 12_500,
    idempotency_key: 'release-key-original',
    claim_token: 'claim-token-1',
    stage_version: 6,
    claim_expires_at: '2026-09-20T00:15:00.000Z',
    stripe_account_id: ACCOUNT,
    payout_create_attempted_at: '2026-09-20T00:10:00.000Z',
  };
  const reconcileFence = {
    p_run_id: 'run-1',
    p_claim_token: 'claim-token-1',
    p_expected_stage_version: 6,
  };
  const mappingQuery = {
    from: 'connect_payout_run_shipments',
    select: 'id, run_id, shipment_id, net_payout, status',
    options: { count: 'exact' },
    filters: [['eq', 'run_id', 'run-1']],
    maybeSingle: false,
  };
  // Five minutes before the durable attempt, in seconds.
  const createdGte = Date.parse('2026-09-20T00:10:00.000Z') / 1000 - 300;

  test('completes the fence from the one listed payout of the run and never creates', async () => {
    const result = await invoke({
      rpc: {
        fn_claim_awaiting_balance_payout_run: [ok(null)],
        fn_claim_payout_create_reconciliation: [
          ok([reconciliationClaim]),
          ok(null),
        ],
        fn_verify_payout_claim: [ok(true)],
        fn_complete_payout_create_fence: [ok(true)],
      },
      listPayouts: async () => ({
        data: [
          { id: 'po_other', metadata: { run_id: 'run-2' } },
          { id: 'po_found', metadata: { run_id: 'run-1' } },
        ],
      }),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ...emptySummary,
      claimed: 1,
      resumed: 1,
      results: [
        { runId: 'run-1', status: 'resumed', stripePayoutId: 'po_found' },
      ],
    });
    expect(result.effects).toEqual([
      { rpc: 'fn_claim_awaiting_balance_payout_run', args: claimArgs },
      {
        rpc: 'fn_claim_payout_create_reconciliation',
        args: reconcileClaimArgs,
      },
      mappingQuery,
      releaseRowsQuery,
      { rpc: 'fn_verify_payout_claim', args: reconcileFence },
      {
        stripe: 'payouts.list',
        params: { created: { gte: createdGte }, limit: 100 },
        options: { stripeAccount: ACCOUNT },
      },
      {
        rpc: 'fn_complete_payout_create_fence',
        args: { ...reconcileFence, p_stripe_payout_id: 'po_found' },
      },
      {
        rpc: 'fn_claim_payout_create_reconciliation',
        args: reconcileClaimArgs,
      },
    ]);
  });

  test('aborts to action_required when no listed payout matches the run', async () => {
    const result = await invoke({
      rpc: {
        fn_claim_awaiting_balance_payout_run: [ok(null)],
        fn_claim_payout_create_reconciliation: [
          ok([reconciliationClaim]),
          ok(null),
        ],
        fn_verify_payout_claim: [ok(true)],
        fn_abort_payout_create_to_action_required: [ok(true)],
      },
    });

    expect(result.body.results).toEqual([
      {
        runId: 'run-1',
        status: 'action_required',
        reason: 'unresolved_create_outcome',
      },
    ]);
    expect(result.effects.slice(6)).toEqual([
      {
        rpc: 'fn_abort_payout_create_to_action_required',
        args: {
          ...reconcileFence,
          p_reason: 'PAYOUT_CREATE_RECONCILIATION_MATCHES:0',
        },
      },
      {
        rpc: 'fn_claim_payout_create_reconciliation',
        args: reconcileClaimArgs,
      },
    ]);
  });

  test('releases the claim when the mapping query fails', async () => {
    const result = await invoke({
      rpc: {
        fn_claim_awaiting_balance_payout_run: [ok(null)],
        fn_claim_payout_create_reconciliation: [
          ok([reconciliationClaim]),
          ok(null),
        ],
        fn_release_payout_claim: [ok(null)],
      },
      query: (query) =>
        query.table === 'connect_payout_run_shipments'
          ? { data: null, error: { message: 'db down' }, count: null }
          : defaultQuery(query),
    });

    expect(result.body.results).toEqual([
      {
        runId: 'run-1',
        status: 'error',
        error: 'RECONCILIATION_MAPPING_LOOKUP_FAILED',
      },
    ]);
    expect(result.effects.slice(3)).toEqual([
      {
        rpc: 'fn_release_payout_claim',
        args: { p_run_id: 'run-1', p_claim_token: 'claim-token-1' },
      },
      {
        rpc: 'fn_claim_payout_create_reconciliation',
        args: reconcileClaimArgs,
      },
    ]);
  });
});
