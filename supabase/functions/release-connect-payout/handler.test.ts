import { describe, expect, it } from 'bun:test';

import {
  createReleaseConnectPayoutHandler,
  createSupabaseReleasePayoutPorts,
  type ReleaseConnectPayoutDependencies,
  type ReleaseConnectPayoutStripeClient,
  type SupabaseAdminClient,
} from './handler';
import { ConnectPayoutReleaseError } from './release-connect-payout';

type Result = { data: unknown; error: unknown };
type Query = {
  table: string;
  ops: unknown[][];
  terminal: 'await' | 'maybeSingle' | 'single';
};
type Effect = unknown[];

const ok = (data: unknown): Result => ({ data, error: null });
const dbError = { code: 'P0001', message: 'boom', details: 'd', hint: 'h' };

const releaseRow = (overrides: Record<string, unknown> = {}) => ({
  shipment_id: 'shipment-1',
  seller_id: 'seller-1',
  status: 'completed',
  completed_at: '2026-06-21T12:00:00.000Z',
  is_eligible: true,
  ineligible_reason: null,
  order_id: 'order-1',
  release_amount_cents: 12_500,
  stripe_account_id: 'acct_seller_1',
  stripe_onboarding_status: 'complete',
  stripe_transfer_id: null,
  ...overrides,
});

const runRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'run-1',
  seller_id: 'seller-1',
  amount: 12_500,
  status: 'pending_reconciliation',
  stripe_payout_id: null,
  release_stage: 'release_accepted',
  release_stage_version: 1,
  payout_claim_token: null,
  payout_claim_expires_at: null,
  connect_payout_run_shipments: [{ shipment_id: 'shipment-1' }],
  ...overrides,
});

const transferEnvelope = {
  transfer_token: 'opaque-token',
  amount: 12_500,
  currency: 'mxn',
  destination: 'acct_seller_1',
  source_transaction: 'ch_1',
  transfer_group: 'group_1',
  idempotency_key: 'release-key:run-1:shipment-1',
  metadata: {
    app_name: 'selene',
    run_id: 'run-1',
    shipment_id: 'shipment-1',
    seller_id: 'seller-1',
    order_id: 'order-1',
  },
};

type Responders = {
  user?: { id: string } | null;
  authError?: unknown;
  from?: (query: Query) => Result | undefined;
  rpc?: (name: string, args: unknown, count: number) => Result | undefined;
  stripe?: Partial<Record<string, (...args: unknown[]) => unknown>>;
};

/** Default responses for one fresh single-modal release that reaches a payout. */
function defaultFrom(query: Query, state: { mapped: boolean }): Result {
  const eq = query.ops.find((op) => op[0] === 'eq');
  switch (query.table) {
    case 'profiles_private':
      return ok({ role: 'admin' });
    case 'connect_payout_runs':
      if (query.ops.some((op) => op[0] === 'insert')) {
        return ok({
          id: 'run-1',
          status: 'pending_reconciliation',
          release_stage: 'release_accepted',
          release_stage_version: 1,
        });
      }
      return ok(eq?.[1] === 'id' ? runRow() : null);
    case 'connect_payout_run_shipments':
      if (query.ops.some((op) => op[0] === 'insert')) {
        state.mapped = true;
        return ok(null);
      }
      return ok(
        state.mapped
          ? [
              {
                run_id: 'run-1',
                shipment_id: 'shipment-1',
                status: 'pending_reconciliation',
              },
            ]
          : [],
      );
    case 'admin_connect_payout_release_view':
      return ok([releaseRow()]);
    case 'orders':
      return ok([
        {
          id: 'order-1',
          stripe_charge_id: 'ch_1',
          stripe_transfer_group: 'group_1',
        },
      ]);
    default:
      throw new Error(`unexpected table ${query.table}`);
  }
}

function defaultRpc(name: string): Result {
  switch (name) {
    case 'fn_get_connect_account_actionability':
      return ok([{ is_actionable: true, blocked_reason: null }]);
    case 'fn_begin_shipment_transfer':
      return ok(transferEnvelope);
    case 'fn_complete_shipment_transfer':
      return ok(true);
    case 'fn_begin_manual_payout_create_fence':
      return ok(2);
    case 'fn_complete_payout_create_fence':
      return ok(true);
    default:
      throw new Error(`unexpected rpc ${name}`);
  }
}

function createFakes(responders: Responders = {}) {
  const effects: Effect[] = [];
  const state = { mapped: false };
  const rpcCounts = new Map<string, number>();

  const resolve = (query: Query): Result => {
    effects.push(['from', query.table, query.ops, query.terminal]);
    return responders.from?.(query) ?? defaultFrom(query, state);
  };

  const builder = (table: string) => {
    const ops: unknown[][] = [];
    const chain = {
      select: (...args: unknown[]) => (ops.push(['select', ...args]), chain),
      eq: (...args: unknown[]) => (ops.push(['eq', ...args]), chain),
      in: (...args: unknown[]) => (ops.push(['in', ...args]), chain),
      insert: (...args: unknown[]) => (ops.push(['insert', ...args]), chain),
      update: (...args: unknown[]) => (ops.push(['update', ...args]), chain),
      maybeSingle: async () => resolve({ table, ops, terminal: 'maybeSingle' }),
      single: async () => resolve({ table, ops, terminal: 'single' }),
      then: (
        onFulfilled: (value: Result) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve()
          .then(() => resolve({ table, ops, terminal: 'await' }))
          .then(onFulfilled, onRejected),
    };
    return chain;
  };

  const supabase = {
    auth: {
      getUser: async (token: string) => {
        effects.push(['auth.getUser', token]);
        return {
          data: {
            user:
              responders.user === undefined
                ? { id: 'admin-1' }
                : responders.user,
          },
          error: responders.authError ?? null,
        };
      },
    },
    from: (table: string) => builder(table),
    rpc: async (name: string, args: unknown) => {
      const count = (rpcCounts.get(name) ?? 0) + 1;
      rpcCounts.set(name, count);
      effects.push(['rpc', name, args]);
      return responders.rpc?.(name, args, count) ?? defaultRpc(name);
    },
  };

  const stripeCall =
    (name: string, fallback: (...args: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      effects.push([`stripe.${name}`, ...args]);
      return (responders.stripe?.[name] ?? fallback)(...args);
    };
  const stripe = {
    transfers: {
      create: stripeCall('transfers.create', () => ({ id: 'tr_1' })),
    },
    payouts: {
      create: stripeCall('payouts.create', () => ({
        id: 'po_1',
        lastResponse: { requestId: 'req_1' },
      })),
      retrieve: stripeCall('payouts.retrieve', (payoutId) => ({
        id: payoutId,
        status: 'failed',
        failure_balance_transaction: 'txn_1',
        amount: 12_500,
        currency: 'mxn',
        destination: 'ba_1',
      })),
    },
    balance: {
      retrieve: stripeCall('balance.retrieve', () => ({
        available: [{ amount: 99_999, currency: 'mxn', source_types: {} }],
        pending: [],
      })),
    },
  };

  return {
    effects,
    supabase: supabase as unknown as SupabaseAdminClient,
    stripe: stripe as unknown as ReleaseConnectPayoutStripeClient,
  };
}

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_1',
  SUPABASE_URL: 'http://127.0.0.1:54321',
};

function setup(
  responders: Responders = {},
  env: Partial<Record<keyof typeof ENV, string | undefined>> = ENV,
  secretKey: string | null = 'sb_secret_1',
) {
  const fakes = createFakes(responders);
  const wiring: unknown[][] = [];
  const deps: ReleaseConnectPayoutDependencies = {
    getEnv: (name) => {
      wiring.push(['getEnv', name]);
      return env[name];
    },
    readSupabaseSecretKey: () => {
      wiring.push(['readSupabaseSecretKey']);
      return secretKey ?? undefined;
    },
    createSupabaseAdmin: (url, key, options) => {
      wiring.push(['createSupabaseAdmin', url, key, options]);
      return fakes.supabase;
    },
    createStripe: (secret) => {
      wiring.push(['createStripe', secret]);
      return fakes.stripe;
    },
  };
  return { ...fakes, wiring, handler: createReleaseConnectPayoutHandler(deps) };
}

const post = (body: unknown, authorization: string | null = 'Bearer token-1') =>
  new Request('http://localhost/functions/v1/release-connect-payout', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const releaseBody = {
  sellerId: 'seller-1',
  shipmentIds: ['shipment-1'],
  idempotencyKey: 'release-key',
};

async function call(
  handler: (req: Request) => Promise<Response>,
  req: Request,
) {
  const response = await handler(req);
  return { status: response.status, body: await response.json() };
}

const fullWiring = [
  ['getEnv', 'STRIPE_SECRET_KEY'],
  ['readSupabaseSecretKey'],
  ['getEnv', 'SUPABASE_URL'],
  [
    'createSupabaseAdmin',
    'http://127.0.0.1:54321',
    'sb_secret_1',
    { auth: { autoRefreshToken: false, persistSession: false } },
  ],
  ['createStripe', 'sk_test_1'],
];

const RUN_COLUMNS =
  'id, seller_id, amount, status, stripe_payout_id, release_stage, release_stage_version, payout_claim_token, payout_claim_expires_at, connect_payout_run_shipments(shipment_id)';
const ACTIVE_STATUSES = [
  'pending_reconciliation',
  'paid',
  'reconciliation_needed',
];

const profileLookup = [
  'from',
  'profiles_private',
  [
    ['select', 'role'],
    ['eq', 'id', 'admin-1'],
  ],
  'maybeSingle',
];
const actionabilityRpc = [
  'rpc',
  'fn_get_connect_account_actionability',
  { p_stripe_account_id: 'acct_seller_1' },
];
const activeMappingsLookup = [
  'from',
  'connect_payout_run_shipments',
  [
    ['select', 'run_id, shipment_id, status'],
    ['in', 'shipment_id', ['shipment-1']],
    ['in', 'status', ACTIVE_STATUSES],
  ],
  'await',
];
const releaseViewLookup = [
  'from',
  'admin_connect_payout_release_view',
  [
    ['select', '*'],
    ['in', 'shipment_id', ['shipment-1']],
  ],
  'await',
];
const transferContext = {
  p_run_id: 'run-1',
  p_shipment_id: 'shipment-1',
  p_expected_stage_version: 1,
};

const hasStripeEffect = (effects: Effect[]) =>
  effects.some((effect) => String(effect[0]).startsWith('stripe.'));

describe('release-connect-payout handler', () => {
  it('answers 405 for a non-POST request before reading config or creating any client', async () => {
    const { handler, wiring, effects } = setup();
    const response = await call(
      handler,
      new Request('http://localhost/', { method: 'GET' }),
    );
    expect(response).toEqual({
      status: 405,
      body: { success: false, error: 'METHOD_NOT_ALLOWED' },
    });
    expect(wiring).toEqual([]);
    expect(effects).toEqual([]);
  });

  for (const missing of [
    'STRIPE_SECRET_KEY',
    'SUPABASE_URL',
    'secret',
  ] as const) {
    it(`answers 500 MISSING_SERVER_CONFIG without ${missing} before any client`, async () => {
      const { handler, wiring, effects } = setup(
        {},
        missing === 'secret' ? ENV : { ...ENV, [missing]: undefined },
        missing === 'secret' ? null : 'sb_secret_1',
      );
      expect(await call(handler, post(releaseBody))).toEqual({
        status: 500,
        body: { success: false, error: 'MISSING_SERVER_CONFIG' },
      });
      expect(wiring).toEqual(fullWiring.slice(0, 3));
      expect(effects).toEqual([]);
    });
  }

  for (const authorization of [null, 'token-1', 'bearer token-1']) {
    it(`answers 401 for Authorization ${authorization} without a client`, async () => {
      const { handler, wiring, effects } = setup();
      expect(await call(handler, post(releaseBody, authorization))).toEqual({
        status: 401,
        body: { success: false, error: 'AUTH_REQUIRED' },
      });
      expect(wiring).toEqual(fullWiring.slice(0, 3));
      expect(effects).toEqual([]);
    });
  }

  for (const [label, responders] of [
    ['an auth error', { authError: { message: 'bad jwt' }, user: null }],
    ['no user', { user: null }],
    ['an auth error with a user', { authError: { message: 'x' } }],
  ] as const) {
    it(`answers 401 for ${label} before any table, RPC or Stripe call`, async () => {
      const { handler, wiring, effects } = setup(responders);
      expect(await call(handler, post(releaseBody))).toEqual({
        status: 401,
        body: { success: false, error: 'AUTH_REQUIRED' },
      });
      expect(wiring).toEqual(fullWiring.slice(0, 4));
      expect(effects).toEqual([['auth.getUser', 'token-1']]);
    });
  }

  it('answers 403 ADMIN_REQUIRED for a non-admin after only the role lookup', async () => {
    const { handler, wiring, effects } = setup({
      from: (query) =>
        query.table === 'profiles_private' ? ok({ role: 'user' }) : undefined,
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 403,
      body: { success: false, error: 'ADMIN_REQUIRED' },
    });
    expect(wiring).toEqual(fullWiring);
    expect(effects).toEqual([['auth.getUser', 'token-1'], profileLookup]);
  });

  it('answers 403 when the caller has no private profile', async () => {
    const { handler, effects } = setup({
      from: (query) =>
        query.table === 'profiles_private' ? ok(null) : undefined,
    });
    expect((await call(handler, post(releaseBody))).status).toBe(403);
    expect(effects).toEqual([['auth.getUser', 'token-1'], profileLookup]);
  });

  it('answers 500 PROFILE_LOOKUP_FAILED when the role lookup fails', async () => {
    const { handler, effects } = setup({
      from: (query) =>
        query.table === 'profiles_private'
          ? { data: null, error: dbError }
          : undefined,
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 500,
      body: { success: false, error: 'PROFILE_LOOKUP_FAILED' },
    });
    expect(effects).toEqual([['auth.getUser', 'token-1'], profileLookup]);
  });

  for (const [body, error] of [
    ['not json', 'SELLER_ID_REQUIRED'],
    [[1], 'INVALID_REQUEST'],
    [{ ...releaseBody, shipmentIds: [] }, 'SHIPMENTS_REQUIRED'],
    [{ retryRunId: 'run-1', sellerId: 'seller-1' }, 'INVALID_RETRY_REQUEST'],
  ] as const) {
    it(`answers 400 ${error} after auth, without Stripe or database effects`, async () => {
      const { handler, wiring, effects } = setup();
      expect(await call(handler, post(body))).toEqual({
        status: 400,
        body: { success: false, error },
      });
      expect(wiring).toEqual(fullWiring.slice(0, 4));
      expect(effects).toEqual([['auth.getUser', 'token-1']]);
    });
  }

  it('releases a single-modal shipment: begin transfer, Stripe transfer, complete, fence, payout, fence exit', async () => {
    const { handler, wiring, effects } = setup();
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 200,
      body: {
        success: true,
        runId: 'run-1',
        stripePayoutId: 'po_1',
        status: 'pending_reconciliation',
        amount: 12_500,
      },
    });
    expect(wiring).toEqual(fullWiring);
    expect(effects).toEqual([
      ['auth.getUser', 'token-1'],
      profileLookup,
      [
        'from',
        'connect_payout_runs',
        [
          ['select', RUN_COLUMNS],
          ['eq', 'idempotency_key', 'release-key'],
        ],
        'maybeSingle',
      ],
      activeMappingsLookup,
      releaseViewLookup,
      actionabilityRpc,
      [
        'from',
        'orders',
        [
          ['select', 'id, stripe_charge_id, stripe_transfer_group'],
          ['in', 'id', ['order-1']],
        ],
        'await',
      ],
      [
        'from',
        'connect_payout_runs',
        [
          [
            'insert',
            {
              actor_id: 'admin-1',
              seller_id: 'seller-1',
              amount: 12_500,
              idempotency_key: 'release-key',
              retry_of_run_id: null,
              status: 'pending_reconciliation',
              release_stage: 'release_accepted',
            },
          ],
          ['select', 'id, status, release_stage, release_stage_version'],
        ],
        'single',
      ],
      [
        'from',
        'connect_payout_run_shipments',
        [
          [
            'insert',
            [
              {
                run_id: 'run-1',
                shipment_id: 'shipment-1',
                net_payout: 12_500,
                status: 'pending_reconciliation',
              },
            ],
          ],
        ],
        'await',
      ],
      ['rpc', 'fn_begin_shipment_transfer', transferContext],
      [
        'stripe.transfers.create',
        {
          amount: 12_500,
          currency: 'mxn',
          destination: 'acct_seller_1',
          source_transaction: 'ch_1',
          transfer_group: 'group_1',
          metadata: transferEnvelope.metadata,
        },
        { idempotencyKey: 'release-key:run-1:shipment-1' },
      ],
      [
        'rpc',
        'fn_complete_shipment_transfer',
        {
          ...transferContext,
          p_transfer_token: 'opaque-token',
          p_stripe_transfer_id: 'tr_1',
        },
      ],
      ['stripe.balance.retrieve', {}, { stripeAccount: 'acct_seller_1' }],
      [
        'from',
        'connect_payout_runs',
        [
          ['select', RUN_COLUMNS],
          ['eq', 'id', 'run-1'],
        ],
        'maybeSingle',
      ],
      ['rpc', 'fn_begin_manual_payout_create_fence', { p_run_id: 'run-1' }],
      releaseViewLookup,
      activeMappingsLookup,
      actionabilityRpc,
      [
        'stripe.payouts.create',
        {
          amount: 12_500,
          currency: 'mxn',
          metadata: {
            app_name: 'selene',
            run_id: 'run-1',
            seller_id: 'seller-1',
            shipment_ids: 'shipment-1',
          },
        },
        { stripeAccount: 'acct_seller_1', idempotencyKey: 'release-key' },
      ],
      [
        'rpc',
        'fn_complete_payout_create_fence',
        {
          p_run_id: 'run-1',
          p_claim_token: null,
          p_expected_stage_version: 2,
          p_stripe_payout_id: 'po_1',
        },
      ],
    ]);
  });

  it('answers 500 and stops before Stripe when the begin-transfer RPC fails', async () => {
    const { handler, effects } = setup({
      rpc: (name) =>
        name === 'fn_begin_shipment_transfer'
          ? { data: transferEnvelope, error: dbError }
          : undefined,
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 500,
      body: { success: false, error: 'SHIPMENT_TRANSFER_BEGIN_FAILED' },
    });
    expect(effects.at(-1)).toEqual([
      'rpc',
      'fn_begin_shipment_transfer',
      transferContext,
    ]);
    expect(hasStripeEffect(effects)).toBe(false);
  });

  it('answers 500 and creates no payout when the complete-transfer RPC fails', async () => {
    const { handler, effects } = setup({
      rpc: (name) =>
        name === 'fn_complete_shipment_transfer'
          ? { data: true, error: dbError }
          : undefined,
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 500,
      body: { success: false, error: 'SHIPMENT_TRANSFER_UPDATE_FAILED' },
    });
    expect(effects.at(-1)?.[1]).toBe('fn_complete_shipment_transfer');
    expect(
      effects.filter((effect) => effect[0] === 'stripe.payouts.create'),
    ).toEqual([]);
  });

  it('logs and rethrows a Stripe transfer error without completing the transfer', async () => {
    const stripeError = Object.assign(new Error('card_declined'), {
      type: 'StripeInvalidRequestError',
    });
    const { handler, effects } = setup({
      stripe: {
        'transfers.create': () => {
          throw stripeError;
        },
      },
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 400,
      body: { success: false, error: 'card_declined' },
    });
    expect(effects.at(-1)?.[0]).toBe('stripe.transfers.create');
  });

  it('parks the run through the fence-park RPC when the account turns non-actionable at the fence', async () => {
    const { handler, effects } = setup({
      rpc: (name, _args, count) => {
        if (name === 'fn_get_connect_account_actionability' && count === 2) {
          return ok([{ is_actionable: false, blocked_reason: 'errored' }]);
        }
        if (name === 'fn_park_payout_run_from_fence') {
          return ok([{ outcome: 'parked', stage_version: 3 }]);
        }
        return undefined;
      },
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 200,
      body: {
        success: true,
        runId: 'run-1',
        status: 'reconciliation_needed',
        amount: 12_500,
      },
    });
    expect(effects.at(-1)).toEqual([
      'rpc',
      'fn_park_payout_run_from_fence',
      { p_run_id: 'run-1', p_expected_stage_version: 2 },
    ]);
    expect(
      effects.filter((effect) => effect[0] === 'stripe.payouts.create'),
    ).toEqual([]);
  });

  it('answers the not-actionable refusal when the fence-park result is malformed', async () => {
    const { handler, effects } = setup({
      rpc: (name, _args, count) => {
        if (name === 'fn_get_connect_account_actionability' && count === 2) {
          return ok([{ is_actionable: false, blocked_reason: 'errored' }]);
        }
        if (name === 'fn_park_payout_run_from_fence') {
          return ok([{ outcome: 'failed', stage_version: 3 }]);
        }
        return undefined;
      },
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 409,
      body: { success: false, error: 'CONNECT_ACCOUNT_NOT_ACTIONABLE' },
    });
    expect(effects.at(-1)?.[1]).toBe('fn_park_payout_run_from_fence');
    expect(hasStripeEffect(effects.slice(-4))).toBe(false);
  });

  it('parks a lost fence exit only through the sync-failed RPC, never a direct run update', async () => {
    const { handler, effects } = setup({
      rpc: (name) => {
        if (name === 'fn_complete_payout_create_fence') {
          return { data: null, error: dbError };
        }
        if (name === 'fn_mark_payout_run_sync_failed') return ok(true);
        return undefined;
      },
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 400,
      body: { success: false, error: 'P0001 boom' },
    });
    expect(effects.slice(-2)).toEqual([
      [
        'rpc',
        'fn_complete_payout_create_fence',
        {
          p_run_id: 'run-1',
          p_claim_token: null,
          p_expected_stage_version: 2,
          p_stripe_payout_id: 'po_1',
        },
      ],
      [
        'rpc',
        'fn_mark_payout_run_sync_failed',
        {
          p_run_id: 'run-1',
          p_stripe_payout_id: 'po_1',
          p_failure_reason: 'P0001 boom',
        },
      ],
    ]);
    expect(
      effects.some(
        (effect) =>
          effect[0] === 'from' &&
          (effect[2] as unknown[][]).some((op) => op[0] === 'update'),
      ),
    ).toBe(false);
  });

  it('maps an open-fence conflict from the fence RPC to 409 without calling payouts.create', async () => {
    const { handler, effects } = setup({
      rpc: (name) =>
        name === 'fn_begin_manual_payout_create_fence'
          ? {
              data: null,
              error: { code: 'P0001', message: 'PAYOUT_CREATE_FENCE_CONFLICT' },
            }
          : undefined,
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 409,
      body: { success: false, error: 'PAYOUT_RELEASE_RECONCILIATION_REQUIRED' },
    });
    expect(effects.at(-1)).toEqual([
      'rpc',
      'fn_begin_manual_payout_create_fence',
      { p_run_id: 'run-1' },
    ]);
  });

  it('resumes a failed pre-Stripe run through the atomic resume RPC and stops on its refusal', async () => {
    const resumed = runRow({
      status: 'failed',
      release_stage: 'payout_failed',
      release_stage_version: 7,
    });
    const { handler, effects } = setup({
      from: (query) =>
        query.table === 'connect_payout_runs' &&
        query.ops.some((op) => op[0] === 'eq' && op[1] === 'idempotency_key')
          ? ok(resumed)
          : undefined,
      rpc: (name) =>
        name === 'fn_atomic_payout_resume_mapping' ? ok(null) : undefined,
    });
    expect(await call(handler, post(releaseBody))).toEqual({
      status: 409,
      body: { success: false, error: 'PAYOUT_RESUME_MAPPING_CONFLICT' },
    });
    expect(effects.at(-1)).toEqual([
      'rpc',
      'fn_atomic_payout_resume_mapping',
      {
        p_run_id: 'run-1',
        p_mode: 'retry',
        p_expected_status: 'failed',
        p_expected_stage: 'payout_failed',
        p_expected_version: 7,
        p_shipment_ids: ['shipment-1'],
        p_parent_run_id: null,
        p_expected_parent_version: null,
        p_expected_parent_payout_id: null,
      },
    ]);
    expect(hasStripeEffect(effects)).toBe(false);
    expect(
      effects.some((effect) => String(effect[1]).includes('shipment_transfer')),
    ).toBe(false);
  });

  it('reaches account actionability only through the RPC, never the revoked tables', async () => {
    const { handler, effects } = setup();
    await call(handler, post(releaseBody));
    const tables = effects
      .filter((effect) => effect[0] === 'from')
      .map((effect) => effect[1]);
    expect(tables).not.toContain('connect_account_actionability');
    expect(tables).not.toContain('connect_account_events');
    expect(
      effects.filter(
        (effect) => effect[1] === 'fn_get_connect_account_actionability',
      ),
    ).toHaveLength(2);
  });
});

describe('createSupabaseReleasePayoutPorts', () => {
  const ports = (responders: Responders = {}) => {
    const fakes = createFakes(responders);
    return {
      ...fakes,
      ports: createSupabaseReleasePayoutPorts(fakes.supabase, fakes.stripe),
    };
  };
  const failing = (table: string): Responders => ({
    from: (query) =>
      query.table === table ? { data: null, error: dbError } : undefined,
  });

  it('maps every lookup failure to its 500 error', async () => {
    const cases: Array<[() => Promise<unknown>, string]> = [];
    const runs = ports(failing('connect_payout_runs'));
    cases.push(
      [() => runs.ports.findRunByIdempotencyKey('k'), 'RUN_LOOKUP_FAILED'],
      [() => runs.ports.findRunById('run-1'), 'RUN_LOOKUP_FAILED'],
      [
        () => runs.ports.findRetryChildByParentRunId('run-1'),
        'RETRY_CHILD_LOOKUP_FAILED',
      ],
      [
        () =>
          runs.ports.createRun({
            actorId: 'admin-1',
            sellerId: 'seller-1',
            amount: 1,
            idempotencyKey: 'k',
          }),
        'RUN_CREATE_FAILED',
      ],
    );
    const mappings = ports(failing('connect_payout_run_shipments'));
    cases.push(
      [
        () => mappings.ports.findActiveShipmentMappings(['shipment-1']),
        'ACTIVE_RELEASE_LOOKUP_FAILED',
      ],
      [
        () =>
          mappings.ports.createRunShipments({
            runId: 'run-1',
            shipments: [{ shipmentId: 'shipment-1', netPayout: 1 }],
          }),
        'RUN_SHIPMENTS_CREATE_FAILED',
      ],
    );
    const view = ports(failing('admin_connect_payout_release_view'));
    cases.push([
      () => view.ports.loadReleaseRows(['shipment-1']),
      'RELEASE_VIEW_FAILED',
    ]);
    const orders = ports(failing('orders'));
    cases.push([
      () => orders.ports.loadReleaseOrders(['order-1']),
      'ORDER_LOOKUP_FAILED',
    ]);
    expect(cases).toHaveLength(8);
    for (const [run, code] of cases) {
      await expect(run()).rejects.toEqual(
        new ConnectPayoutReleaseError(code, 500),
      );
    }
  });

  it('maps run rows with their shipment ids for the three run lookups', async () => {
    const row = runRow({
      connect_payout_run_shipments: [
        { shipment_id: 'shipment-1' },
        { shipment_id: null },
        { shipment_id: 'shipment-2' },
      ],
      payout_claim_token: 'claim',
      payout_claim_expires_at: '2026-06-21T12:00:00.000Z',
    });
    const { ports: p, effects } = ports({
      from: (query) =>
        query.table === 'connect_payout_runs' ? ok(row) : undefined,
    });
    const expected = {
      id: 'run-1',
      seller_id: 'seller-1',
      shipment_ids: ['shipment-1', 'shipment-2'],
      amount: 12_500,
      status: 'pending_reconciliation',
      stripe_payout_id: null,
      release_stage: 'release_accepted',
      release_stage_version: 1,
      payout_claim_token: 'claim',
      payout_claim_expires_at: '2026-06-21T12:00:00.000Z',
    };
    expect(await p.findRunByIdempotencyKey('k')).toEqual(expected);
    expect(await p.findRunById('run-1')).toEqual(expected);
    expect(await p.findRetryChildByParentRunId('run-0')).toEqual(expected);
    expect(effects.map((effect) => effect[2])).toEqual([
      [
        ['select', RUN_COLUMNS],
        ['eq', 'idempotency_key', 'k'],
      ],
      [
        ['select', RUN_COLUMNS],
        ['eq', 'id', 'run-1'],
      ],
      [
        ['select', RUN_COLUMNS],
        ['eq', 'retry_of_run_id', 'run-0'],
      ],
    ]);
  });

  it('records a retry child run with its parent id', async () => {
    const { ports: p, effects } = ports();
    expect(
      await p.createRun({
        actorId: 'admin-1',
        sellerId: 'seller-1',
        amount: 500,
        idempotencyKey: 'connect-payout-retry:run-0',
        retryOfRunId: 'run-0',
      }),
    ).toEqual({
      id: 'run-1',
      status: 'pending_reconciliation',
      release_stage: 'release_accepted',
      release_stage_version: 1,
    });
    expect(effects[0]?.[2]).toEqual([
      [
        'insert',
        {
          actor_id: 'admin-1',
          seller_id: 'seller-1',
          amount: 500,
          idempotency_key: 'connect-payout-retry:run-0',
          retry_of_run_id: 'run-0',
          status: 'pending_reconciliation',
          release_stage: 'release_accepted',
        },
      ],
      ['select', 'id, status, release_stage, release_stage_version'],
    ]);
  });

  for (const [method, mode, error] of [
    ['markRunRetrying', 'retry', 'RUN_RETRY_MARK_FAILED'],
    ['markRunPendingReconciliation', 'pending', 'RUN_UPDATE_FAILED'],
  ] as const) {
    it(`${method} calls only the atomic resume RPC and treats a non-version as refusal`, async () => {
      const intent = {
        runId: 'run-2',
        expectedStatus: 'pending_reconciliation' as const,
        expectedStage: 'release_accepted',
        expectedVersion: 4,
        shipmentIds: ['shipment-1'],
        parent: { runId: 'run-0', stageVersion: 9, stripePayoutId: 'po_0' },
      };
      const args = {
        p_run_id: 'run-2',
        p_mode: mode,
        p_expected_status: 'pending_reconciliation',
        p_expected_stage: 'release_accepted',
        p_expected_version: 4,
        p_shipment_ids: ['shipment-1'],
        p_parent_run_id: 'run-0',
        p_expected_parent_version: 9,
        p_expected_parent_payout_id: 'po_0',
      };
      for (const [data, expected] of [
        [5, 5],
        [null, null],
        [false, null],
        [0, null],
        ['5', null],
        [1.5, null],
      ] as const) {
        const { ports: p, effects } = ports({ rpc: () => ok(data) });
        expect(await p[method](intent)).toBe(expected);
        expect(effects).toEqual([
          ['rpc', 'fn_atomic_payout_resume_mapping', args],
        ]);
      }
      const { ports: p } = ports({ rpc: () => ({ data: 5, error: dbError }) });
      await expect(p[method](intent)).rejects.toEqual(
        new ConnectPayoutReleaseError(error, 500),
      );
    });
  }

  it('reads account actionability through its RPC, defaulting an absent row to actionable', async () => {
    for (const [data, expected] of [
      [
        [{ is_actionable: false, blocked_reason: 'errored' }],
        { isActionable: false, blockedReason: 'errored' },
      ],
      [
        { is_actionable: false, blocked_reason: null },
        { isActionable: false, blockedReason: null },
      ],
      [[], { isActionable: true, blockedReason: null }],
      [null, { isActionable: true, blockedReason: null }],
    ] as const) {
      const { ports: p, effects } = ports({ rpc: () => ok(data) });
      expect(
        await p.getConnectAccountActionability({ stripeAccountId: 'acct_1' }),
      ).toEqual(expected);
      expect(effects).toEqual([
        [
          'rpc',
          'fn_get_connect_account_actionability',
          { p_stripe_account_id: 'acct_1' },
        ],
      ]);
    }
    const { ports: p } = ports({ rpc: () => ({ data: null, error: dbError }) });
    await expect(
      p.getConnectAccountActionability({ stripeAccountId: 'acct_1' }),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('ACCOUNT_ACTIONABILITY_LOOKUP_FAILED', 500),
    );
  });

  it('calls each fence RPC with the manual (null) claim token and the fenced version', async () => {
    const { ports: p, effects } = ports({
      rpc: (name) =>
        name === 'fn_begin_manual_payout_create_fence'
          ? ok('3')
          : name === 'fn_park_payout_run_from_fence'
            ? ok([{ outcome: 'requeued', stage_version: 4 }])
            : ok(true),
    });
    expect(await p.beginPayoutCreateFence({ runId: 'run-1' })).toBe(3);
    expect(
      await p.completePayoutCreateFence({
        runId: 'run-1',
        stageVersion: 3,
        stripePayoutId: 'po_1',
      }),
    ).toBe(true);
    expect(
      await p.failPayoutCreateFromFence({
        runId: 'run-1',
        stageVersion: 3,
        failureReason: 'R',
      }),
    ).toBe(true);
    expect(
      await p.abortPayoutCreateToActionRequired({
        runId: 'run-1',
        stageVersion: 3,
        reason: 'A',
      }),
    ).toBe(true);
    expect(
      await p.parkPayoutRunFromFence({ runId: 'run-1', stageVersion: 3 }),
    ).toEqual({ outcome: 'requeued', stageVersion: 4 });
    expect(
      await p.markRunPayoutSyncFailed({
        runId: 'run-1',
        stripePayoutId: 'po_1',
        failureReason: 'S',
      }),
    ).toBe(true);
    const fence = {
      p_run_id: 'run-1',
      p_claim_token: null,
      p_expected_stage_version: 3,
    };
    expect(effects).toEqual([
      ['rpc', 'fn_begin_manual_payout_create_fence', { p_run_id: 'run-1' }],
      [
        'rpc',
        'fn_complete_payout_create_fence',
        { ...fence, p_stripe_payout_id: 'po_1' },
      ],
      [
        'rpc',
        'fn_fail_payout_create_from_fence',
        { ...fence, p_failure_reason: 'R' },
      ],
      [
        'rpc',
        'fn_abort_payout_create_to_action_required',
        { ...fence, p_reason: 'A' },
      ],
      [
        'rpc',
        'fn_park_payout_run_from_fence',
        { p_run_id: 'run-1', p_expected_stage_version: 3 },
      ],
      [
        'rpc',
        'fn_mark_payout_run_sync_failed',
        {
          p_run_id: 'run-1',
          p_stripe_payout_id: 'po_1',
          p_failure_reason: 'S',
        },
      ],
    ]);
  });

  it('answers false for a refused fence exit or sync fallback', async () => {
    const { ports: p } = ports({ rpc: () => ok(false) });
    const input = { runId: 'run-1', stageVersion: 3 };
    expect(
      await p.completePayoutCreateFence({ ...input, stripePayoutId: 'po_1' }),
    ).toBe(false);
    expect(
      await p.failPayoutCreateFromFence({ ...input, failureReason: 'R' }),
    ).toBe(false);
    expect(
      await p.abortPayoutCreateToActionRequired({ ...input, reason: 'A' }),
    ).toBe(false);
    expect(
      await p.markRunPayoutSyncFailed({
        runId: 'run-1',
        stripePayoutId: 'po_1',
        failureReason: 'S',
      }),
    ).toBe(false);
  });

  it('throws the code and message of a failed fence RPC, and a mapped error for the sync fallback', async () => {
    const { ports: p } = ports({ rpc: () => ({ data: null, error: dbError }) });
    const input = { runId: 'run-1', stageVersion: 3 };
    for (const run of [
      () => p.beginPayoutCreateFence({ runId: 'run-1' }),
      () => p.completePayoutCreateFence({ ...input, stripePayoutId: 'po_1' }),
      () => p.failPayoutCreateFromFence({ ...input, failureReason: 'R' }),
      () => p.abortPayoutCreateToActionRequired({ ...input, reason: 'A' }),
      () => p.parkPayoutRunFromFence(input),
    ]) {
      await expect(run()).rejects.toThrow(new Error('P0001 boom'));
    }
    await expect(
      p.markRunPayoutSyncFailed({
        runId: 'run-1',
        stripePayoutId: 'po_1',
        failureReason: 'S',
      }),
    ).rejects.toEqual(
      new ConnectPayoutReleaseError('RUN_RECONCILIATION_MARK_FAILED', 500),
    );
    const { ports: malformed } = ports({ rpc: () => ok([{ outcome: 'x' }]) });
    await expect(malformed.parkPayoutRunFromFence(input)).rejects.toEqual(
      new ConnectPayoutReleaseError('PAYOUT_FENCE_PARK_RESULT_INVALID', 409),
    );
  });

  it('passes Stripe payout retrieval and balance reads to the connected account', async () => {
    const { ports: p, effects } = ports();
    expect(
      await p.retrieveStripePayout({
        payoutId: 'po_9',
        stripeAccountId: 'acct_1',
      }),
    ).toEqual({
      id: 'po_9',
      status: 'failed',
      failure_balance_transaction: 'txn_1',
      amount: 12_500,
      currency: 'mxn',
    });
    expect(
      await p.retrieveConnectedBalance({ stripeAccountId: 'acct_1' }),
    ).toEqual({ available: [{ amount: 99_999, currency: 'mxn' }] });
    expect(effects).toEqual([
      ['stripe.payouts.retrieve', 'po_9', {}, { stripeAccount: 'acct_1' }],
      ['stripe.balance.retrieve', {}, { stripeAccount: 'acct_1' }],
    ]);
  });

  it('rethrows a Stripe payout create error unchanged', async () => {
    const stripeError = new Error('payout failed');
    const { ports: p } = ports({
      stripe: {
        'payouts.create': () => {
          throw stripeError;
        },
      },
    });
    await expect(
      p.createStripePayout({
        stripeAccountId: 'acct_1',
        amount: 1,
        currency: 'mxn',
        idempotencyKey: 'k',
        metadata: {
          app_name: 'selene',
          run_id: 'run-1',
          seller_id: 'seller-1',
          shipment_ids: 'shipment-1',
        },
        orderIds: ['order-1'],
      }),
    ).rejects.toBe(stripeError);
  });
});
