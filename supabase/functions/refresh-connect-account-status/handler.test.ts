import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import type { ConnectAccountLike } from '../_shared/stripe/connect-status.ts';
import {
  createRefreshConnectAccountStatusHandler,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type Query = { table: string; ops: unknown[][] };
type Result = { data?: unknown; error?: unknown };

const SELLER_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000a2';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';
const TOKEN = 'seller-access-token';
const ADMIN_TOKEN = 'admin-access-token';
const NOW = new Date('2026-11-11T12:00:00.000Z');
const LONG_AGO = '2026-11-11T11:00:00.000Z';
const RECENT = '2026-11-11T11:59:30.000Z';
const PROFILE_COLUMNS =
  'id, role, stripe_account_id, stripe_onboarding_status, stripe_onboarding_refreshed_at';

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  SUPABASE_URL: 'https://project.supabase.co',
};

const profile = (id: string, overrides: Row = {}): Row => ({
  id,
  role: 'user',
  stripe_account_id: `acct_${id.slice(-2)}`,
  stripe_onboarding_status: 'pending',
  stripe_onboarding_refreshed_at: LONG_AGO,
  ...overrides,
});

// A recording Supabase client over `profiles_private` rows; `events` lists token checks and
// table reads in order.
function fakeSupabase(
  input: {
    profiles?: Row[];
    lookupError?: unknown;
    updateError?: unknown;
    authError?: unknown;
  } = {},
) {
  const profiles = input.profiles ?? [
    profile(SELLER_ID),
    profile(OTHER_ID),
    profile(ADMIN_ID, { role: 'admin', stripe_account_id: null }),
  ];
  const users: Record<string, Row> = {
    [TOKEN]: { id: SELLER_ID },
    [ADMIN_TOKEN]: { id: ADMIN_ID },
  };
  const events: string[] = [];
  const queries: Query[] = [];
  const respond = (query: Query): Result => {
    if (query.ops[0][0] === 'update') {
      return { error: input.updateError ?? null };
    }
    const id = query.ops.find(([op]) => op === 'eq')?.[2];
    return {
      data: profiles.find((row) => row.id === id) ?? null,
      error: input.lookupError ?? null,
    };
  };
  const client = {
    auth: {
      getUser: async (token: string) => {
        events.push(`auth:${token}`);
        const user = users[token] ?? null;
        return {
          data: { user },
          error: input.authError ?? (user ? null : { message: 'invalid JWT' }),
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
      chain.maybeSingle = () => {
        query.ops.push(['maybeSingle']);
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

function harness(
  input: {
    db?: ReturnType<typeof fakeSupabase>;
    account?: ConnectAccountLike;
    retrieveError?: Error;
    env?: Record<string, string | undefined>;
    secretKey?: string;
  } = {},
) {
  const db = input.db ?? fakeSupabase();
  const env = { ...ENV, ...input.env };
  const created: unknown[][] = [];
  const retrieved: string[] = [];
  const handler = createRefreshConnectAccountStatusHandler({
    getEnv: (name) => env[name],
    readSupabaseSecretKey: () =>
      'secretKey' in input ? input.secretKey : 'sb_secret_x',
    createSupabaseAdmin: (url, key) => {
      created.push(['supabase', url, key]);
      return db.client;
    },
    createStripe: (secret) => {
      created.push(['stripe', secret]);
      return {
        accounts: {
          retrieve: async (accountId) => {
            retrieved.push(accountId);
            if (input.retrieveError) throw input.retrieveError;
            return (
              input.account ?? { charges_enabled: true, payouts_enabled: true }
            );
          },
        },
      };
    },
    now: () => NOW,
  });
  return { handler, db, created, retrieved };
}

const request = (
  body: unknown = {},
  authorization: string | null = `Bearer ${TOKEN}`,
) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authorization !== null) headers.set('Authorization', authorization);
  return new Request(
    'https://example.test/functions/v1/refresh-connect-account-status',
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
};

const expectJson = async (
  response: Response,
  status: number,
  body: unknown,
) => {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toBe('application/json');
  expect(await response.json()).toEqual(body);
};

const lookup = (id: string): Query => ({
  table: 'profiles_private',
  ops: [['select', PROFILE_COLUMNS], ['eq', 'id', id], ['maybeSingle']],
});

const update = (id: string, status: string): Query => ({
  table: 'profiles_private',
  ops: [
    [
      'update',
      {
        stripe_onboarding_status: status,
        stripe_onboarding_refreshed_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
      },
    ],
    ['eq', 'id', id],
  ],
});

const FRESH_COMPLETE = {
  status: 'complete',
  hasStripeAccount: true,
  chargesEnabled: true,
  payoutsEnabled: true,
  refreshedAt: NOW.toISOString(),
  cached: false,
};

describe('refresh-connect-account-status handler', () => {
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
      const { handler, created } = harness({ env, secretKey });

      await expectJson(await handler(request()), 500, {
        error: 'MISSING_SERVER_CONFIG',
      });
      expect(created).toEqual([]);
    });
  }

  it('answers 401 without an Authorization header, before any client', async () => {
    const { handler, created, db } = harness();

    await expectJson(await handler(request({}, null)), 401, {
      error: 'AUTH_REQUIRED',
    });
    expect(created).toEqual([]);
    expect(db.events).toEqual([]);
  });

  it('answers 401 for a token the auth server rejects, before any table read or Stripe client', async () => {
    const { handler, created, db, retrieved } = harness();

    await expectJson(await handler(request({}, 'Bearer stolen-token')), 401, {
      error: 'AUTH_REQUIRED',
    });
    expect(db.events).toEqual(['auth:stolen-token']);
    expect(created).toEqual([
      ['supabase', 'https://project.supabase.co', 'sb_secret_x'],
    ]);
    expect(retrieved).toEqual([]);
  });

  it('answers 401 when the auth server reports an error, even with a user object', async () => {
    const db = fakeSupabase({ authError: { message: 'jwt expired' } });
    const { handler, retrieved } = harness({ db });

    await expectJson(await handler(request()), 401, { error: 'AUTH_REQUIRED' });
    expect(db.events).toEqual([`auth:${TOKEN}`]);
    expect(retrieved).toEqual([]);
  });

  it("refreshes the verified caller's own account from Stripe and stores the status", async () => {
    const { handler, db, created, retrieved } = harness();

    // A body caller id is not an input: the caller is the verified user.
    await expectJson(
      await handler(request({ callerId: ADMIN_ID, userId: ADMIN_ID })),
      200,
      FRESH_COMPLETE,
    );
    expect(created).toEqual([
      ['supabase', 'https://project.supabase.co', 'sb_secret_x'],
      ['stripe', 'sk_test_x'],
    ]);
    expect(retrieved).toEqual(['acct_a1']);
    expect(db.queries).toEqual([
      lookup(SELLER_ID),
      update(SELLER_ID, 'complete'),
    ]);
  });

  it('answers 403 FORBIDDEN when a non-admin names another seller, with no Stripe call or write', async () => {
    const { handler, db, retrieved } = harness();

    await expectJson(await handler(request({ sellerId: OTHER_ID })), 403, {
      error: 'FORBIDDEN',
    });
    expect(retrieved).toEqual([]);
    expect(db.queries).toEqual([lookup(SELLER_ID), lookup(OTHER_ID)]);
  });

  it("lets an admin force a refresh of another seller's recently refreshed account", async () => {
    const db = fakeSupabase({
      profiles: [
        profile(OTHER_ID, { stripe_onboarding_refreshed_at: RECENT }),
        profile(ADMIN_ID, { role: 'admin', stripe_account_id: null }),
      ],
    });
    const { handler, retrieved } = harness({
      db,
      account: { requirements: { disabled_reason: 'rejected.fraud' } },
    });

    await expectJson(
      await handler(
        request({ sellerId: OTHER_ID, force: true }, `Bearer ${ADMIN_TOKEN}`),
      ),
      200,
      {
        status: 'rejected',
        hasStripeAccount: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        refreshedAt: NOW.toISOString(),
        cached: false,
      },
    );
    expect(retrieved).toEqual(['acct_a2']);
    expect(db.queries).toEqual([
      lookup(ADMIN_ID),
      lookup(OTHER_ID),
      update(OTHER_ID, 'rejected'),
    ]);
  });

  it('answers an admin the cached status of another seller inside the throttle window unless forced', async () => {
    const db = fakeSupabase({
      profiles: [
        profile(OTHER_ID, { stripe_onboarding_refreshed_at: RECENT }),
        profile(ADMIN_ID, { role: 'admin', stripe_account_id: null }),
      ],
    });
    const { handler, retrieved } = harness({ db });

    await expectJson(
      await handler(request({ sellerId: OTHER_ID }, `Bearer ${ADMIN_TOKEN}`)),
      200,
      {
        status: 'pending',
        hasStripeAccount: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        refreshedAt: RECENT,
        cached: true,
      },
    );
    expect(retrieved).toEqual([]);
    expect(db.queries).toEqual([lookup(ADMIN_ID), lookup(OTHER_ID)]);
  });

  it('answers the cached status inside the throttle window without calling Stripe', async () => {
    const db = fakeSupabase({
      profiles: [
        profile(SELLER_ID, { stripe_onboarding_refreshed_at: RECENT }),
      ],
    });
    const { handler, retrieved } = harness({ db });

    await expectJson(await handler(request({ force: true })), 200, {
      status: 'pending',
      hasStripeAccount: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      refreshedAt: RECENT,
      cached: true,
    });
    expect(retrieved).toEqual([]);
    expect(db.queries).toEqual([lookup(SELLER_ID)]);
  });

  it('answers the cached status with STRIPE_REFRESH_FAILED when Stripe fails, and writes nothing', async () => {
    const { handler, db } = harness({ retrieveError: new Error('timeout') });

    await expectJson(await handler(request()), 200, {
      status: 'pending',
      hasStripeAccount: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      refreshedAt: LONG_AGO,
      cached: true,
      error: 'STRIPE_REFRESH_FAILED',
    });
    expect(db.queries).toEqual([lookup(SELLER_ID)]);
  });

  it('answers 500 PROFILE_LOOKUP_FAILED when the profile read fails', async () => {
    const { handler, retrieved } = harness({
      db: fakeSupabase({ lookupError: { message: 'down' } }),
    });

    await expectJson(await handler(request()), 500, {
      error: 'PROFILE_LOOKUP_FAILED',
    });
    expect(retrieved).toEqual([]);
  });

  it('answers 500 PROFILE_UPDATE_FAILED when the status write fails', async () => {
    const { handler } = harness({
      db: fakeSupabase({ updateError: { message: 'denied' } }),
    });

    await expectJson(await handler(request()), 500, {
      error: 'PROFILE_UPDATE_FAILED',
    });
  });

  it('answers 404 CONNECT_ACCOUNT_NOT_FOUND for a caller without a Connect account', async () => {
    const { handler, retrieved } = harness({
      db: fakeSupabase({
        profiles: [profile(SELLER_ID, { stripe_account_id: null })],
      }),
    });

    await expectJson(await handler(request()), 404, {
      error: 'CONNECT_ACCOUNT_NOT_FOUND',
    });
    expect(retrieved).toEqual([]);
  });

  it('answers 400 with the message of any other error', async () => {
    const db = fakeSupabase();
    (db.client.auth as unknown as { getUser: () => never }).getUser = () => {
      throw new Error('auth server unreachable');
    };
    const { handler } = harness({ db });

    await expectJson(await handler(request()), 400, {
      error: 'auth server unreachable',
    });
  });
});
