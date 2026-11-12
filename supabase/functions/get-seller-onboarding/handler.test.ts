import { describe, expect, it } from 'bun:test';

import {
  createGetSellerOnboardingHandler,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type Query = { table: string; ops: unknown[][] };
type Result = { data?: unknown; error?: unknown };

const USER_ID = '00000000-0000-4000-8000-0000000000a1';
const TOKEN = 'user-access-token';
const SUPABASE_URL = 'https://project.supabase.co';

const ROW = {
  id: '00000000-0000-4000-8000-0000000000a9',
  username: 'seller',
  email: 'seller@example.test',
  stripe_account_id: 'acct_1',
  stripe_onboarding_status: 'complete',
  charges_enabled: true,
  created_at: '2026-11-01T00:00:00.000Z',
};

// A recording Supabase client: `respond` answers each query once its chain settles, and
// `events` lists token checks and table reads in order.
function fakeSupabase(
  respond: (query: Query) => Result,
  authError: unknown = null,
) {
  const events: string[] = [];
  const queries: Query[] = [];
  const users: Record<string, Row> = { [TOKEN]: { id: USER_ID } };
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
      for (const op of ['select', 'eq', 'order']) {
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

const database = (
  input: {
    profile?: Row | null;
    profileError?: unknown;
    rows?: Row[] | null;
    viewError?: unknown;
  } = {},
) =>
  fakeSupabase((query) =>
    query.table === 'profiles_private'
      ? {
          data:
            'profile' in input
              ? input.profile
              : {
                  role: 'user',
                  stripe_account_id: 'acct_1',
                  stripe_onboarding_status: 'pending',
                },
          error: input.profileError ?? null,
        }
      : {
          data: 'rows' in input ? input.rows : [ROW],
          error: input.viewError ?? null,
        },
  );

function harness(
  input: {
    db?: ReturnType<typeof fakeSupabase>;
    supabaseUrl?: string;
    secretKey?: string;
  } = {},
) {
  const db = input.db ?? database();
  const created: unknown[][] = [];
  const handler = createGetSellerOnboardingHandler({
    getEnv: (name) =>
      name === 'SUPABASE_URL'
        ? 'supabaseUrl' in input
          ? input.supabaseUrl
          : SUPABASE_URL
        : undefined,
    readSupabaseSecretKey: () =>
      'secretKey' in input ? input.secretKey : 'sb_secret_x',
    createSupabaseAdmin: (url, key) => {
      created.push([url, key]);
      return db.client;
    },
  });
  return { handler, db, created };
}

const request = (authorization: string | null = `Bearer ${TOKEN}`) => {
  const headers = new Headers();
  if (authorization !== null) headers.set('Authorization', authorization);
  return new Request(
    'https://example.test/functions/v1/get-seller-onboarding',
    { method: 'POST', headers },
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

const PROFILE_LOOKUP: Query = {
  table: 'profiles_private',
  ops: [
    ['select', 'role, stripe_account_id, stripe_onboarding_status'],
    ['eq', 'id', USER_ID],
    ['maybeSingle'],
  ],
};

describe('get-seller-onboarding handler', () => {
  for (const [missing, input] of [
    ['the Supabase secret key', { secretKey: undefined }],
    ['SUPABASE_URL', { supabaseUrl: undefined }],
  ] as const) {
    it(`answers 500 MISSING_SERVER_CONFIG without ${missing}, before any client`, async () => {
      const { handler, created } = harness(input);

      await expectJson(await handler(request()), 500, {
        success: false,
        error: 'MISSING_SERVER_CONFIG',
      });
      expect(created).toEqual([]);
    });
  }

  for (const [label, authorization] of [
    ['no Authorization header', null],
    ['a non-Bearer Authorization header', `Basic ${TOKEN}`],
  ] as const) {
    it(`answers 401 with ${label}, before creating a client`, async () => {
      const { handler, created, db } = harness();

      await expectJson(await handler(request(authorization)), 401, {
        success: false,
        error: 'AUTH_REQUIRED',
      });
      expect(created).toEqual([]);
      expect(db.events).toEqual([]);
    });
  }

  it('answers 401 for a token the auth server rejects, before any table read', async () => {
    const { handler, db } = harness();

    await expectJson(await handler(request('Bearer stolen-token')), 401, {
      success: false,
      error: 'AUTH_REQUIRED',
    });
    expect(db.events).toEqual(['auth:stolen-token']);
  });

  it('answers 401 when the auth server reports an error, even with a user object', async () => {
    const db = fakeSupabase(() => ({}), { message: 'jwt expired' });
    const { handler } = harness({ db });

    await expectJson(await handler(request()), 401, {
      success: false,
      error: 'AUTH_REQUIRED',
    });
    expect(db.events).toEqual([`auth:${TOKEN}`]);
  });

  it("returns a non-admin caller's own onboarding state and never reads the admin view", async () => {
    const { handler, db, created } = harness();

    await expectJson(await handler(request()), 200, {
      success: true,
      has_stripe_account: true,
      stripe_onboarding_status: 'pending',
    });
    expect(created).toEqual([[SUPABASE_URL, 'sb_secret_x']]);
    expect(db.events).toEqual([`auth:${TOKEN}`, 'from:profiles_private']);
    expect(db.queries).toEqual([PROFILE_LOOKUP]);
  });

  it('returns every seller row, newest first, to an admin', async () => {
    const { handler, db } = harness({
      db: database({
        profile: {
          role: 'admin',
          stripe_account_id: null,
          stripe_onboarding_status: null,
        },
      }),
    });

    await expectJson(await handler(request()), 200, {
      success: true,
      rows: [ROW],
    });
    expect(db.queries).toEqual([
      PROFILE_LOOKUP,
      {
        table: 'admin_seller_onboarding_view',
        ops: [
          ['select', '*'],
          ['order', 'created_at', { ascending: false }],
        ],
      },
    ]);
  });

  it('answers 500 SELLER_ONBOARDING_UNAVAILABLE when the admin view read fails', async () => {
    const { handler } = harness({
      db: database({
        profile: {
          role: 'admin',
          stripe_account_id: null,
          stripe_onboarding_status: null,
        },
        viewError: { message: 'denied' },
      }),
    });

    await expectJson(await handler(request()), 500, {
      success: false,
      error: 'SELLER_ONBOARDING_UNAVAILABLE',
    });
  });

  it('answers 500 PROFILE_LOOKUP_FAILED when the profile read fails', async () => {
    const { handler, db } = harness({
      db: database({ profile: null, profileError: { message: 'down' } }),
    });

    await expectJson(await handler(request()), 500, {
      success: false,
      error: 'PROFILE_LOOKUP_FAILED',
    });
    expect(db.queries).toEqual([PROFILE_LOOKUP]);
  });

  it('answers 404 PROFILE_NOT_FOUND without a profile', async () => {
    const { handler } = harness({ db: database({ profile: null }) });

    await expectJson(await handler(request()), 404, {
      success: false,
      error: 'PROFILE_NOT_FOUND',
    });
  });
});
