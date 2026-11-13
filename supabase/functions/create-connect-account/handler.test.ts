import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  createCreateConnectAccountHandler,
  type ConnectAccountStripe,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type Query = { table: string; ops: unknown[][] };
type Result = { data?: unknown; error?: unknown };

const SELLER_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000a2';
const TOKEN = 'seller-access-token';
const SUPABASE_URL = 'https://project.supabase.co';
const BRIDGE = `${SUPABASE_URL}/functions/v1/connect-onboarding-return`;

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  SUPABASE_URL,
};

// A recording Supabase client: `respond` answers each query once its chain settles, and
// `events` lists token checks and table reads in order.
function fakeSupabase(
  respond: (query: Query) => Result,
  users: Record<string, Row> = {
    [TOKEN]: { id: SELLER_ID, email: 'seller@example.test' },
  },
  authError: unknown = null,
) {
  const events: string[] = [];
  const queries: Query[] = [];
  const client = {
    auth: {
      getUser: async (token: string) => {
        events.push(`auth:${token}`);
        const user = users[token] ?? null;
        return {
          data: { user },
          error: authError ?? (user ? null : { message: 'invalid JWT' }),
        };
      },
    },
    from: (table: string) => {
      events.push(`from:${table}`);
      const query: Query = { table, ops: [] };
      queries.push(query);
      const settle = () =>
        Promise.resolve({ data: null, error: null, ...respond(query) });
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
          settle().then(ok, ko),
      };
      for (const op of ['select', 'eq', 'update']) {
        chain[op] = (...args: unknown[]) => {
          query.ops.push([op, ...args]);
          return chain;
        };
      }
      chain.single = () => {
        query.ops.push(['single']);
        return settle();
      };
      return chain;
    },
    rpc: (name: string) => {
      events.push(`rpc:${name}`);
      throw new Error('unexpected rpc');
    },
  };
  return { client: client as unknown as SupabaseAdminClient, events, queries };
}

const profileWith =
  (profile: Row | null, errors: { lookup?: unknown; update?: unknown } = {}) =>
  (query: Query): Result =>
    query.ops[0][0] === 'update'
      ? { error: errors.update ?? null }
      : { data: profile, error: errors.lookup ?? null };

function fakeStripe(
  overrides: {
    accountId?: string;
    linkUrl?: string;
    createError?: Error;
    balanceSettingsError?: Error;
  } = {},
) {
  const calls: unknown[][] = [];
  const stripe: ConnectAccountStripe = {
    v2: {
      core: {
        accounts: {
          create: async (params) => {
            calls.push(['v2.core.accounts.create', params]);
            if (overrides.createError) throw overrides.createError;
            return { id: overrides.accountId ?? 'acct_created' };
          },
        },
        accountLinks: {
          create: async (params) => {
            calls.push(['v2.core.accountLinks.create', params]);
            return { url: overrides.linkUrl ?? 'https://connect.stripe.com/x' };
          },
        },
      },
    },
    balanceSettings: {
      update: async (params, options) => {
        calls.push(['balanceSettings.update', params, options]);
        if (overrides.balanceSettingsError) {
          throw overrides.balanceSettingsError;
        }
        return {};
      },
    },
  };
  return { stripe, calls };
}

function harness(
  input: {
    database?: ReturnType<typeof fakeSupabase>;
    stripe?: ReturnType<typeof fakeStripe>;
    env?: Record<string, string | undefined>;
    secretKey?: string;
  } = {},
) {
  const database =
    input.database ??
    fakeSupabase(profileWith({ stripe_account_id: null, email: null }));
  const stripe = input.stripe ?? fakeStripe();
  const env = { ...ENV, ...input.env };
  const created: unknown[][] = [];
  const handler = createCreateConnectAccountHandler({
    getEnv: (name) => env[name],
    readSupabaseSecretKey: () =>
      'secretKey' in input ? input.secretKey : 'sb_secret_x',
    createStripe: (secret) => {
      created.push(['stripe', secret]);
      return stripe.stripe;
    },
    createSupabaseAdmin: (url, key) => {
      created.push(['supabase', url, key]);
      return database.client;
    },
  });
  return { handler, database, stripe, created };
}

const request = (
  body: unknown = {},
  authorization: string | null = `Bearer ${TOKEN}`,
) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authorization !== null) headers.set('Authorization', authorization);
  return new Request(
    'https://example.test/functions/v1/create-connect-account',
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
};

const expectError = async (
  response: Response,
  status: number,
  error: string,
) => {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toBe('application/json');
  expect(await response.json()).toEqual({ error });
};

const MANUAL_PAYOUTS = {
  payments: { payouts: { schedule: { interval: 'manual' } } },
};

const manualPayoutsFor = (account: string) => [
  'balanceSettings.update',
  MANUAL_PAYOUTS,
  { stripeAccount: account },
];

const onboardingLinkFor = (
  account: string,
  returnUrl = `${BRIDGE}?state=return`,
  refreshUrl = `${BRIDGE}?state=refresh`,
) => [
  'v2.core.accountLinks.create',
  {
    account,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: { return_url: returnUrl, refresh_url: refreshUrl },
    },
  },
];

const v2AccountFor = (email: string | undefined) => ({
  identity: { country: 'mx' },
  dashboard: 'express',
  ...(email === undefined ? {} : { contact_email: email }),
  defaults: {
    currency: 'mxn',
    responsibilities: {
      fees_collector: 'application',
      losses_collector: 'application',
    },
  },
  configuration: {
    recipient: {
      capabilities: {
        stripe_balance: { stripe_transfers: { requested: true } },
      },
    },
  },
  metadata: { supabase_user_id: SELLER_ID, app_name: 'selene' },
});

const STORE_CREATED: Query = {
  table: 'profiles_private',
  ops: [
    [
      'update',
      {
        stripe_account_id: 'acct_created',
        stripe_onboarding_status: 'pending',
      },
    ],
    ['eq', 'id', SELLER_ID],
  ],
};

const PROFILE_LOOKUP: Query = {
  table: 'profiles_private',
  ops: [
    ['select', 'stripe_account_id, stripe_onboarding_status, email'],
    ['eq', 'id', SELLER_ID],
    ['single'],
  ],
};

describe('create-connect-account handler', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore: () => void }).mockRestore();
  });

  for (const [missing, env, secretKey] of [
    ['STRIPE_SECRET_KEY', { STRIPE_SECRET_KEY: undefined }, 'sb_secret_x'],
    ['the Supabase secret key', {}, undefined],
    ['SUPABASE_URL', { SUPABASE_URL: undefined }, 'sb_secret_x'],
  ] as const) {
    it(`answers 500 MISSING_SERVER_CONFIG without ${missing}, before any client`, async () => {
      const { handler, created, database, stripe } = harness({
        env,
        secretKey,
      });

      await expectError(await handler(request()), 500, 'MISSING_SERVER_CONFIG');
      expect(created).toEqual([]);
      expect(database.events).toEqual([]);
      expect(stripe.calls).toEqual([]);
    });
  }

  it('answers 401 without an Authorization header, before any Supabase client or Stripe call', async () => {
    const { handler, created, database, stripe } = harness();

    await expectError(await handler(request({}, null)), 401, 'AUTH_REQUIRED');
    expect(created).toEqual([['stripe', 'sk_test_x']]);
    expect(database.events).toEqual([]);
    expect(stripe.calls).toEqual([]);
  });

  it('answers 401 for a token the auth server rejects, before any table or Stripe call', async () => {
    const { handler, database, stripe } = harness();

    await expectError(
      await handler(request({}, 'Bearer stolen-token')),
      401,
      'AUTH_REQUIRED',
    );
    expect(database.events).toEqual(['auth:stolen-token']);
    expect(stripe.calls).toEqual([]);
  });

  it('answers 401 when the auth server reports an error, even with a user object', async () => {
    const database = fakeSupabase(
      profileWith({ stripe_account_id: null, email: null }),
      undefined,
      { message: 'jwt expired' },
    );
    const { handler, stripe } = harness({ database });

    await expectError(await handler(request()), 401, 'AUTH_REQUIRED');
    expect(database.events).toEqual([`auth:${TOKEN}`]);
    expect(stripe.calls).toEqual([]);
  });

  it('builds the clients from the configured URL and secrets', async () => {
    const { handler, created } = harness();

    expect((await handler(request())).status).toBe(200);
    expect(created).toEqual([
      ['stripe', 'sk_test_x'],
      ['supabase', SUPABASE_URL, 'sb_secret_x'],
    ]);
  });

  it('rejects a non-string link with 400 before any table or Stripe call', async () => {
    const { handler, database, stripe } = harness();

    const response = await handler(request({ refreshUrl: 123 }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(JSON.parse(body.error)).toMatchObject([
      { code: 'invalid_type', path: ['refreshUrl'] },
    ]);
    expect(database.events).toEqual([`auth:${TOKEN}`]);
    expect(stripe.calls).toEqual([]);
  });

  it('creates a v2 recipient account for the verified seller, stores it, sets manual payouts and returns the link', async () => {
    const { handler, database, stripe } = harness();

    // A body that names another user must not change whose account is created.
    const response = await handler(
      request({
        userId: OTHER_ID,
        sellerId: OTHER_ID,
        returnUrl: 'https://evil.example/return',
        refreshUrl: 'selene://refresh',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json()).toEqual({
      url: 'https://connect.stripe.com/x',
    });
    expect(database.queries).toEqual([PROFILE_LOOKUP, STORE_CREATED]);
    expect(stripe.calls).toEqual([
      ['v2.core.accounts.create', v2AccountFor('seller@example.test')],
      manualPayoutsFor('acct_created'),
      onboardingLinkFor('acct_created'),
    ]);
  });

  it('requests no merchant configuration, no card_payments and no v1 account type', async () => {
    const { handler, stripe } = harness();

    expect((await handler(request())).status).toBe(200);
    const params = stripe.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(params.configuration as object)).toEqual(['recipient']);
    expect(JSON.stringify(params)).not.toContain('card_payments');
    expect(params).not.toHaveProperty('type');
    expect(params).not.toHaveProperty('capabilities');
    expect(params).not.toHaveProperty('settings');
  });

  it('sends the account link no configurations field', async () => {
    const { handler, stripe } = harness();

    expect((await handler(request())).status).toBe(200);
    const link = stripe.calls[2][1] as Record<string, unknown>;
    expect(JSON.stringify(link)).not.toContain('configurations');
    expect(Object.keys(link).sort()).toEqual(['account', 'use_case']);
  });

  it('stores the account id before it sets manual payouts', async () => {
    const order: string[] = [];
    const database = fakeSupabase((query) => {
      order.push(`db:${String(query.ops[0][0])}`);
      return profileWith({ stripe_account_id: null, email: null })(query);
    });
    const stripe = fakeStripe();
    const update = stripe.stripe.balanceSettings.update;
    stripe.stripe.balanceSettings.update = async (params, options) => {
      order.push('stripe:balanceSettings.update');
      return update(params, options);
    };
    const { handler } = harness({ database, stripe });

    expect((await handler(request())).status).toBe(200);
    expect(order).toEqual([
      'db:select',
      'db:update',
      'stripe:balanceSettings.update',
    ]);
  });

  it('answers 500 MANUAL_PAYOUTS_FAILED with no link when manual payouts fail on a new account, keeping the stored id', async () => {
    const database = fakeSupabase(
      profileWith({ stripe_account_id: null, email: null }),
    );
    const stripe = fakeStripe({
      balanceSettingsError: new Error('Stripe is down'),
    });
    const { handler } = harness({ database, stripe });

    await expectError(await handler(request()), 500, 'MANUAL_PAYOUTS_FAILED');
    expect(database.queries).toEqual([PROFILE_LOOKUP, STORE_CREATED]);
    expect(stripe.calls).toEqual([
      ['v2.core.accounts.create', v2AccountFor('seller@example.test')],
      manualPayoutsFor('acct_created'),
    ]);
  });

  it('repairs the stored account on the retry after a manual payouts failure, without a second account', async () => {
    // The retry reads the id the failed call stored.
    const database = fakeSupabase(
      profileWith({ stripe_account_id: 'acct_created', email: null }),
    );
    const { handler, stripe } = harness({ database });

    expect((await handler(request())).status).toBe(200);
    expect(database.queries).toEqual([PROFILE_LOOKUP]);
    expect(stripe.calls).toEqual([
      manualPayoutsFor('acct_created'),
      onboardingLinkFor('acct_created'),
    ]);
  });

  it('answers 500 MANUAL_PAYOUTS_FAILED with no link when manual payouts fail on an existing account', async () => {
    const database = fakeSupabase(
      profileWith({ stripe_account_id: 'acct_old', email: null }),
    );
    const stripe = fakeStripe({
      balanceSettingsError: new Error('Stripe is down'),
    });
    const { handler } = harness({ database, stripe });

    await expectError(await handler(request()), 500, 'MANUAL_PAYOUTS_FAILED');
    expect(database.queries).toEqual([PROFILE_LOOKUP]);
    expect(stripe.calls).toEqual([manualPayoutsFor('acct_old')]);
  });

  it('falls back to the profile email when the auth user has none', async () => {
    const database = fakeSupabase(
      profileWith({ stripe_account_id: null, email: 'profile@example.test' }),
      { [TOKEN]: { id: SELLER_ID } },
    );
    const { handler, stripe } = harness({ database });

    expect((await handler(request())).status).toBe(200);
    expect(stripe.calls[0][1]).toEqual(v2AccountFor('profile@example.test'));
  });

  it('sends no contact email when neither the auth user nor the profile has one', async () => {
    const database = fakeSupabase(
      profileWith({ stripe_account_id: null, email: null }),
      { [TOKEN]: { id: SELLER_ID } },
    );
    const { handler, stripe } = harness({ database });

    expect((await handler(request())).status).toBe(200);
    expect(stripe.calls[0][1]).toEqual(v2AccountFor(undefined));
  });

  it('treats an unreadable body as empty', async () => {
    const { handler, stripe } = harness();

    expect((await handler(request('not json'))).status).toBe(200);
    expect(stripe.calls.map(([call]) => call)).toEqual([
      'v2.core.accounts.create',
      'balanceSettings.update',
      'v2.core.accountLinks.create',
    ]);
  });

  it('reuses an existing account: no new account, no profile write, manual payouts again, a fresh link', async () => {
    const database = fakeSupabase(
      profileWith({ stripe_account_id: 'acct_old', email: null }),
    );
    const { handler, stripe } = harness({ database });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://connect.stripe.com/x',
    });
    expect(database.queries).toEqual([PROFILE_LOOKUP]);
    expect(stripe.calls).toEqual([
      manualPayoutsFor('acct_old'),
      onboardingLinkFor('acct_old'),
    ]);
  });

  it('sends Stripe the configured HTTPS return and refresh URLs', async () => {
    const { handler, stripe } = harness({
      env: {
        SELENE_CONNECT_ONBOARDING_RETURN_URL: 'https://selene.example/return',
        SELENE_CONNECT_ONBOARDING_REFRESH_URL: 'https://selene.example/refresh',
      },
    });

    expect((await handler(request())).status).toBe(200);
    expect(stripe.calls[2]).toEqual(
      onboardingLinkFor(
        'acct_created',
        'https://selene.example/return',
        'https://selene.example/refresh',
      ),
    );
  });

  it('uses the configured bridge URL', async () => {
    const { handler, stripe } = harness({
      env: {
        SELENE_CONNECT_ONBOARDING_BRIDGE_URL: 'https://tunnel.example/bridge',
      },
    });

    expect((await handler(request())).status).toBe(200);
    expect(stripe.calls[2]).toEqual(
      onboardingLinkFor(
        'acct_created',
        'https://tunnel.example/bridge?state=return',
        'https://tunnel.example/bridge?state=refresh',
      ),
    );
  });

  it('answers 500 CONNECT_ONBOARDING_BRIDGE_URL_REQUIRED with no HTTPS target, before any table or Stripe call', async () => {
    const { handler, database, stripe } = harness({
      env: { SUPABASE_URL: 'http://127.0.0.1:54321' },
    });

    await expectError(
      await handler(request()),
      500,
      'CONNECT_ONBOARDING_BRIDGE_URL_REQUIRED',
    );
    expect(database.events).toEqual([`auth:${TOKEN}`]);
    expect(stripe.calls).toEqual([]);
  });

  it('answers 404 PROFILE_NOT_FOUND when the profile lookup fails, before any Stripe call', async () => {
    const database = fakeSupabase(
      profileWith(null, { lookup: { message: 'no rows' } }),
    );
    const { handler, stripe } = harness({ database });

    await expectError(await handler(request()), 404, 'PROFILE_NOT_FOUND');
    expect(stripe.calls).toEqual([]);
  });

  it('answers 500 PROFILE_UPDATE_FAILED and mints no link when the account id is not stored', async () => {
    const database = fakeSupabase(
      profileWith(
        { stripe_account_id: null, email: null },
        { update: { message: 'denied' } },
      ),
    );
    const { handler, stripe } = harness({ database });

    await expectError(await handler(request()), 500, 'PROFILE_UPDATE_FAILED');
    expect(stripe.calls.map(([call]) => call)).toEqual([
      'v2.core.accounts.create',
    ]);
  });

  it('answers 500 ACCOUNT_CREATION_FAILED when Stripe returns no account id', async () => {
    const { handler, stripe, database } = harness({
      stripe: fakeStripe({ accountId: '' }),
    });

    await expectError(await handler(request()), 500, 'ACCOUNT_CREATION_FAILED');
    expect(stripe.calls.map(([call]) => call)).toEqual([
      'v2.core.accounts.create',
    ]);
    expect(database.queries).toHaveLength(2);
  });

  it('answers 500 ACCOUNT_LINK_FAILED when Stripe returns a link without a URL', async () => {
    const { handler } = harness({ stripe: fakeStripe({ linkUrl: '' }) });

    await expectError(await handler(request()), 500, 'ACCOUNT_LINK_FAILED');
  });

  it('answers 400 with the message of any other error, and stores nothing', async () => {
    const { handler, database, stripe } = harness({
      stripe: fakeStripe({ createError: new Error('Stripe is down') }),
    });

    await expectError(await handler(request()), 400, 'Stripe is down');
    expect(database.queries).toEqual([PROFILE_LOOKUP]);
    expect(stripe.calls.map(([call]) => call)).toEqual([
      'v2.core.accounts.create',
    ]);
  });
});
