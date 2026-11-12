import { describe, expect, it } from 'bun:test';

import {
  createReconcileConnectPaymentsHandler,
  type ReconcileConnectPaymentsDependencies,
  type ReconcileStripeClient,
  type SupabaseAdminClient,
} from './handler.ts';

const ADMIN_ID = '00000000-0000-4000-8000-0000000000a1';
const BUYER_ID = '00000000-0000-4000-8000-0000000000b1';
const ADMIN_TOKEN = 'admin-access-token';
const BUYER_TOKEN = 'buyer-access-token';

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_reconcile',
  SUPABASE_URL: 'http://127.0.0.1:54321',
};
const SECRET_KEY = 'sb_secret_reconcile';

// Records, in order, every auth check, table read, RPC and Stripe call the handler makes.
function harness(
  input: {
    env?: Record<string, string | undefined>;
    secretKey?: string;
    roles?: Record<string, string>;
    searchResults?: number;
    authError?: string;
  } = {},
) {
  const env = input.env ?? ENV;
  const users: Record<string, string> = {
    [ADMIN_TOKEN]: ADMIN_ID,
    [BUYER_TOKEN]: BUYER_ID,
  };
  const roles = input.roles ?? { [ADMIN_ID]: 'admin', [BUYER_ID]: 'user' };
  const calls: string[] = [];
  const clients: Array<{ url: string; key: string }> = [];
  const stripeSecrets: string[] = [];
  const searches: unknown[] = [];

  const supabase = {
    auth: {
      getUser: async (token: string) => {
        calls.push(`auth:${token}`);
        const id = users[token];
        if (id && input.authError) {
          return {
            data: { user: { id } },
            error: { message: input.authError },
          };
        }
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      const filters: Record<string, unknown> = {};
      let columns = '';
      const chain = {
        select: (selected: string) => {
          columns = selected;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        single: async () => {
          calls.push(`select:${table}:${columns}:${JSON.stringify(filters)}`);
          const role =
            table === 'profiles_private' && typeof filters.id === 'string'
              ? roles[filters.id]
              : undefined;
          return role
            ? { data: { role }, error: null }
            : { data: null, error: { message: 'no rows' } };
        },
      };
      return chain;
    },
    rpc: async (name: string) => {
      calls.push(`rpc:${name}`);
      throw new Error(`unexpected rpc: ${name}`);
    },
  };

  const stripe = {
    paymentIntents: {
      retrieve: async (id: string) => {
        calls.push(`stripe:retrieve:${id}`);
        return { id, status: 'succeeded', metadata: {} };
      },
      search: async (params: unknown) => {
        calls.push('stripe:search');
        searches.push(params);
        return {
          data: Array.from({ length: input.searchResults ?? 3 }, (_, i) => ({
            id: `pi_${i}`,
          })),
        };
      },
    },
  };

  const deps: ReconcileConnectPaymentsDependencies = {
    getEnv: (name) => env[name],
    readSupabaseSecretKey: () =>
      'secretKey' in input ? input.secretKey : SECRET_KEY,
    createSupabaseAdmin: (url, key) => {
      calls.push('client');
      clients.push({ url, key });
      return supabase as unknown as SupabaseAdminClient;
    },
    createStripe: (secret) => {
      calls.push('stripe');
      stripeSecrets.push(secret);
      return stripe as unknown as ReconcileStripeClient;
    },
  };

  return {
    handler: createReconcileConnectPaymentsHandler(deps),
    calls,
    clients,
    stripeSecrets,
    searches,
  };
}

const request = (
  body: unknown = {},
  authorization: string | null = `Bearer ${ADMIN_TOKEN}`,
) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authorization !== null) headers.set('Authorization', authorization);
  return new Request(
    'https://example.test/functions/v1/reconcile-connect-payments',
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
};

const result = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Record<string, unknown>,
});

const RETIRED = {
  success: true,
  reconciled: 0,
  retired: 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED',
};

describe('reconcile-connect-payments handler', () => {
  it.each([
    ['STRIPE_SECRET_KEY', { ...ENV, STRIPE_SECRET_KEY: undefined }, SECRET_KEY],
    ['SUPABASE_URL', { ...ENV, SUPABASE_URL: undefined }, SECRET_KEY],
    ['the secret key', ENV, undefined],
  ])(
    'answers 400 MISSING_SERVER_CONFIG without %s before any client exists',
    async (_missing, env, secretKey) => {
      const h = harness({ env, secretKey });

      expect(await result(await h.handler(request()))).toEqual({
        status: 400,
        body: { success: false, error: 'MISSING_SERVER_CONFIG' },
      });
      expect(h.calls).toEqual([]);
    },
  );

  it('answers 401 AUTH_REQUIRED without an Authorization header before any read or Stripe client', async () => {
    const h = harness();

    expect(await result(await h.handler(request({}, null)))).toEqual({
      status: 401,
      body: { success: false, error: 'AUTH_REQUIRED' },
    });
    expect(h.calls).toEqual(['client']);
  });

  it('answers 401 AUTH_REQUIRED for a token that is not a user, before reading any table', async () => {
    const h = harness();

    expect(
      await result(await h.handler(request({}, 'Bearer anon-key'))),
    ).toEqual({
      status: 401,
      body: { success: false, error: 'AUTH_REQUIRED' },
    });
    expect(h.calls).toEqual(['client', 'auth:anon-key']);
  });

  it('answers 401 when the auth server reports an error, even with an admin user object', async () => {
    const h = harness({ authError: 'jwt expired' });

    expect(await result(await h.handler(request()))).toEqual({
      status: 401,
      body: { success: false, error: 'AUTH_REQUIRED' },
    });
    expect(h.calls).toEqual(['client', `auth:${ADMIN_TOKEN}`]);
  });

  it('answers 403 ADMIN_REQUIRED for a signed-in non-admin, after reading only its own role', async () => {
    const h = harness();

    expect(
      await result(await h.handler(request({}, `Bearer ${BUYER_TOKEN}`))),
    ).toEqual({
      status: 403,
      body: { success: false, error: 'ADMIN_REQUIRED' },
    });
    expect(h.calls).toEqual([
      'client',
      `auth:${BUYER_TOKEN}`,
      'from:profiles_private',
      `select:profiles_private:role:${JSON.stringify({ id: BUYER_ID })}`,
    ]);
  });

  it('answers 403 when the role row is missing', async () => {
    const h = harness({ roles: {} });

    expect((await h.handler(request())).status).toBe(403);
    expect(h.calls).not.toContain('stripe');
  });

  it('builds the admin client from SUPABASE_URL and the secret key, and Stripe from STRIPE_SECRET_KEY', async () => {
    const h = harness();

    await h.handler(request());

    expect(h.clients).toEqual([{ url: ENV.SUPABASE_URL, key: SECRET_KEY }]);
    expect(h.stripeSecrets).toEqual([ENV.STRIPE_SECRET_KEY]);
  });

  it.each([
    [
      '51 ids',
      {
        paymentIntentIds: Array.from({ length: 51 }, (_, i) => `pi_${i}`),
      },
      'too_big',
    ],
    ['an empty id', { paymentIntentIds: [''] }, 'too_small'],
    ['a string', { paymentIntentIds: 'pi_1' }, 'invalid_type'],
  ])(
    'parses the body with ReconcileConnectPaymentsRequestSchema after the admin check (%s: %s)',
    async (_label, body, code) => {
      const h = harness();

      const response = await result(await h.handler(request(body)));

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(
        JSON.parse(String(response.body.error)).map(
          (issue: { code: string }) => issue.code,
        ),
      ).toContain(code);
      expect(h.calls).not.toContain('stripe');
    },
  );

  it('searches succeeded Connect checkout intents when no ids are given, and settles none of them', async () => {
    const h = harness({ searchResults: 3 });

    expect(await result(await h.handler(request('not json')))).toEqual({
      status: 200,
      body: { ...RETIRED, skipped: 3 },
    });
    expect(h.searches).toEqual([
      {
        query: "status:'succeeded' AND metadata['flow']:'connect_checkout'",
        limit: 50,
      },
    ]);
    expect(h.calls.filter((call) => call.startsWith('rpc:'))).toEqual([]);
  });

  it('retrieves the given intents and skips every one, with no database write', async () => {
    const h = harness();

    expect(
      await result(
        await h.handler(request({ paymentIntentIds: ['pi_a', 'pi_b'] })),
      ),
    ).toEqual({ status: 200, body: { ...RETIRED, skipped: 2 } });
    expect(h.calls).toEqual([
      'client',
      `auth:${ADMIN_TOKEN}`,
      'from:profiles_private',
      `select:profiles_private:role:${JSON.stringify({ id: ADMIN_ID })}`,
      'stripe',
      'stripe:retrieve:pi_a',
      'stripe:retrieve:pi_b',
    ]);
  });
});
