import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';
import {
  createCreateReturnIntentHandler,
  type CreateReturnIntentDependencies,
  type ReturnIntentStripeClient,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;

const SELLER_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_USER_ID = '00000000-0000-4000-8000-0000000000a2';
const DISPUTE_ID = '00000000-0000-4000-8000-0000000000e1';
const ORDER_ID = '00000000-0000-4000-8000-0000000000d1';
const SHIPMENT_ID = '00000000-0000-4000-8000-0000000000c1';
const TOKEN = 'seller-access-token';

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_return',
  SUPABASE_URL: 'http://127.0.0.1:54321',
};
const SECRET_KEY = 'sb_secret_return';

const DISPUTE: Row = {
  id: DISPUTE_ID,
  seller_id: SELLER_ID,
  status: 'open',
  order_id: ORDER_ID,
  shipment_id: SHIPMENT_ID,
};
const SELLER_PROFILE: Row = {
  id: SELLER_ID,
  stripe_customer_id: 'cus_seller',
  stripe_account_id: 'acct_seller',
};

// An in-memory database that applies the `.eq` filters the handler uses. Every token check,
// table read, RPC and Stripe call is recorded in `calls`, in order.
function harness(
  input: {
    users?: Record<string, { id: string } | { error: string; id?: string }>;
    disputes?: Row[];
    settings?: Row[];
    profiles?: Row[];
    rpcResult?: { data: unknown; error: { message: string } | null };
  } = {},
) {
  const users = input.users ?? { [TOKEN]: { id: SELLER_ID } };
  const tables: Record<string, Row[]> = {
    disputes: input.disputes ?? [DISPUTE],
    system_settings: input.settings ?? [{ return_label_fee_cents: 45_000 }],
    profiles_private: input.profiles ?? [SELLER_PROFILE],
  };
  const calls: string[] = [];
  const reads: Array<{ table: string; columns: string; filters: Row }> = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const stripeCalls: Array<{ method: string; params: Row; options: Row }> = [];
  const clients: Array<{ url: string; key: string }> = [];
  const stripeSecrets: string[] = [];

  const supabase = {
    auth: {
      getUser: async (token: string) => {
        calls.push(`auth:${token}`);
        const user = users[token];
        if (!user) {
          return { data: { user: null }, error: { message: 'invalid JWT' } };
        }
        return 'error' in user
          ? {
              data: { user: user.id ? { id: user.id } : null },
              error: { message: user.error },
            }
          : { data: { user: { id: user.id } }, error: null };
      },
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      const filters: Row = {};
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
          reads.push({ table, columns, filters });
          const rows = (tables[table] ?? []).filter((row) =>
            Object.entries(filters).every(([key, value]) => row[key] === value),
          );
          return rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { message: 'not exactly one row' } };
        },
      };
      return chain;
    },
    rpc: async (name: string, args: Row) => {
      calls.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      return (
        input.rpcResult ?? {
          data: [{ success: true, error_message: null }],
          error: null,
        }
      );
    },
  };

  const stripe = {
    ephemeralKeys: {
      create: async (params: Row, options: Row) => {
        calls.push('stripe:ephemeralKeys.create');
        stripeCalls.push({ method: 'ephemeralKeys.create', params, options });
        return { secret: 'ek_secret' };
      },
    },
    paymentIntents: {
      create: async (params: Row, options: Row) => {
        calls.push('stripe:paymentIntents.create');
        stripeCalls.push({ method: 'paymentIntents.create', params, options });
        return { id: 'pi_return', client_secret: 'pi_return_secret' };
      },
    },
  };

  const deps: CreateReturnIntentDependencies = {
    getEnv: (name) => ENV[name],
    readSupabaseSecretKey: () => SECRET_KEY,
    createSupabaseAdmin: (url, key) => {
      calls.push('client');
      clients.push({ url, key });
      return supabase as unknown as SupabaseAdminClient;
    },
    createStripe: (secret) => {
      calls.push('stripe');
      stripeSecrets.push(secret);
      return stripe as unknown as ReturnIntentStripeClient;
    },
  };

  return {
    handler: createCreateReturnIntentHandler(deps),
    calls,
    reads,
    rpcCalls,
    stripeCalls,
    clients,
    stripeSecrets,
  };
}

const request = (
  body: unknown = { disputeId: DISPUTE_ID },
  authorization: string | null = `Bearer ${TOKEN}`,
) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authorization !== null) headers.set('Authorization', authorization);
  return new Request('https://example.test/functions/v1/create-return-intent', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
};

const result = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Record<string, unknown>,
});

const touchesDataOrStripe = (call: string) =>
  call.startsWith('from:') ||
  call.startsWith('rpc:') ||
  call.startsWith('stripe:');

describe('create-return-intent handler', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore: () => void }).mockRestore();
  });

  it.each([
    [
      'a non-RFC dispute id',
      { disputeId: '11111111-2222-3333-4444-555555555555' },
    ],
    ['no dispute id', {}],
    ['a body that is not JSON', 'not json'],
  ])(
    'parses the body with ReturnIntentRequestSchema before creating any client (%s)',
    async (_label, body) => {
      const h = harness();

      const response = await result(await h.handler(request(body)));

      expect(response.status).toBe(400);
      expect(
        JSON.parse(String(response.body.error)).map(
          (issue: { path: unknown }) => issue.path,
        ),
      ).toEqual([['disputeId']]);
      expect(h.calls).toEqual([]);
    },
  );

  it('keeps the Spanish message the app shows for a non-RFC dispute id', async () => {
    const h = harness();

    const response = await result(
      await h.handler(
        request({ disputeId: '11111111-2222-3333-4444-555555555555' }),
      ),
    );

    expect(JSON.parse(String(response.body.error))).toEqual([
      expect.objectContaining({
        code: 'invalid_format',
        path: ['disputeId'],
        message: 'ID de disputa inválido',
      }),
    ]);
  });

  it('builds the admin client from SUPABASE_URL and the secret key, and Stripe from STRIPE_SECRET_KEY', async () => {
    const h = harness();

    await h.handler(request());

    expect(h.clients).toEqual([{ url: ENV.SUPABASE_URL, key: SECRET_KEY }]);
    expect(h.stripeSecrets).toEqual([ENV.STRIPE_SECRET_KEY]);
  });

  it.each([
    ['no Authorization header', null, ''],
    ['a token that is not a user', 'Bearer anon-key', 'anon-key'],
  ])(
    'answers 401 AUTH_REQUIRED for %s before any table, RPC or Stripe call',
    async (_label, authorization, token) => {
      const h = harness();

      expect(
        await result(await h.handler(request(undefined, authorization))),
      ).toEqual({ status: 401, body: { error: 'AUTH_REQUIRED' } });
      expect(h.calls).toEqual(['client', 'stripe', `auth:${token}`]);
    },
  );

  it('answers 401 when the auth server reports an error, even with a user object', async () => {
    const h = harness({
      users: { [TOKEN]: { id: SELLER_ID, error: 'jwt expired' } },
    });

    expect(await result(await h.handler(request()))).toEqual({
      status: 401,
      body: { error: 'AUTH_REQUIRED' },
    });
    expect(h.calls.filter(touchesDataOrStripe)).toEqual([]);
  });

  it('answers 404 when the dispute does not exist, before the RPC or Stripe', async () => {
    const h = harness({ disputes: [] });

    expect(await result(await h.handler(request()))).toEqual({
      status: 404,
      body: { error: 'Disputa no encontrada' },
    });
    expect(h.rpcCalls).toEqual([]);
    expect(h.stripeCalls).toEqual([]);
  });

  it('authorizes through fn_seller_initiate_return_label with the verified user, never a body id', async () => {
    const h = harness({ users: { [TOKEN]: { id: OTHER_USER_ID } } });

    await h.handler(
      request({
        disputeId: DISPUTE_ID,
        callerId: SELLER_ID,
        p_caller_id: SELLER_ID,
      }),
    );

    expect(h.rpcCalls).toEqual([
      {
        name: 'fn_seller_initiate_return_label',
        args: { p_dispute_id: DISPUTE_ID, p_caller_id: OTHER_USER_ID },
      },
    ]);
    expect(h.reads.slice(0, 2)).toEqual([
      {
        table: 'disputes',
        columns: 'id, seller_id, status, order_id, shipment_id',
        filters: { id: DISPUTE_ID },
      },
      {
        table: 'system_settings',
        columns: 'return_label_fee_cents',
        filters: {},
      },
    ]);
    // The Stripe customer charged is the dispute's seller, not the caller.
    expect(h.reads[2]?.filters).toEqual({ id: SELLER_ID });
  });

  it.each([
    [
      'the RPC refusal message',
      {
        data: [{ success: false, error_message: 'NOT_DISPUTE_SELLER' }],
        error: null,
      },
      'NOT_DISPUTE_SELLER',
    ],
    [
      'the RPC error message',
      { data: null, error: { message: 'rpc failed' } },
      'rpc failed',
    ],
    ['a generic message', { data: [], error: null }, 'Operación no permitida'],
  ])(
    'answers 400 with %s when the RPC refuses, before any seller read or Stripe call',
    async (_label, rpcResult, message) => {
      const h = harness({ rpcResult });

      expect(await result(await h.handler(request()))).toEqual({
        status: 400,
        body: { error: message },
      });
      expect(h.reads.map((read) => read.table)).not.toContain(
        'profiles_private',
      );
      expect(h.stripeCalls).toEqual([]);
    },
  );

  it('answers 400 when the dispute has no shipment, before any Stripe call', async () => {
    const h = harness({ disputes: [{ ...DISPUTE, shipment_id: null }] });

    expect(await result(await h.handler(request()))).toEqual({
      status: 400,
      body: { error: 'Dispute is not linked to a shipment' },
    });
    expect(h.stripeCalls).toEqual([]);
  });

  it.each([
    [
      'customer',
      { ...SELLER_PROFILE, stripe_customer_id: null },
      'Seller does not have a Stripe customer configured',
    ],
    [
      'Connect account',
      { ...SELLER_PROFILE, stripe_account_id: null },
      'Seller does not have a Stripe Connect account configured',
    ],
  ])(
    'answers 400 when the seller has no Stripe %s, before any Stripe call',
    async (_label, profile, message) => {
      const h = harness({ profiles: [profile] });

      expect(await result(await h.handler(request()))).toEqual({
        status: 400,
        body: { error: message },
      });
      expect(h.stripeCalls).toEqual([]);
    },
  );

  it('charges the seller the return fee from system_settings, not an amount from the body', async () => {
    const h = harness();

    const response = await result(
      await h.handler(
        request({ disputeId: DISPUTE_ID, amount: 1, amountCents: 1 }),
      ),
    );

    expect(response).toEqual({
      status: 200,
      body: {
        clientSecret: 'pi_return_secret',
        ephemeralKey: 'ek_secret',
        customer: 'cus_seller',
        amount: 450,
      },
    });
    expect(h.reads[2]).toEqual({
      table: 'profiles_private',
      columns: 'stripe_customer_id, stripe_account_id',
      filters: { id: SELLER_ID },
    });
    expect(h.stripeCalls).toEqual([
      {
        method: 'ephemeralKeys.create',
        params: { customer: 'cus_seller' },
        options: { apiVersion: STRIPE_API_VERSION },
      },
      {
        method: 'paymentIntents.create',
        params: {
          amount: 45_000,
          currency: 'mxn',
          customer: 'cus_seller',
          automatic_payment_methods: { enabled: true },
          on_behalf_of: 'acct_seller',
          metadata: {
            app_name: 'selene',
            type: 'return_shipping',
            purpose: 'return_shipping',
            dispute_id: DISPUTE_ID,
            order_id: ORDER_ID,
            seller_id: SELLER_ID,
            shipment_id: SHIPMENT_ID,
          },
        },
        options: { idempotencyKey: `return_pay_${DISPUTE_ID}` },
      },
    ]);
  });

  it('falls back to 30000 cents when the settings row has no fee', async () => {
    const h = harness({ settings: [{ return_label_fee_cents: null }] });

    const response = await result(await h.handler(request()));

    expect(response.body.amount).toBe(300);
    expect(h.stripeCalls[1]?.params.amount).toBe(30_000);
  });

  it('answers 400 with the Stripe message when the PaymentIntent cannot be created', async () => {
    const handler = createCreateReturnIntentHandler({
      getEnv: (name) => ENV[name],
      readSupabaseSecretKey: () => SECRET_KEY,
      createSupabaseAdmin: () =>
        ({
          auth: {
            getUser: async () => ({
              data: { user: { id: SELLER_ID } },
              error: null,
            }),
          },
          from: (table: string) => {
            const rows: Record<string, Row> = {
              disputes: DISPUTE,
              system_settings: { return_label_fee_cents: 45_000 },
              profiles_private: SELLER_PROFILE,
            };
            const chain = {
              select: () => chain,
              eq: () => chain,
              single: async () => ({ data: rows[table], error: null }),
            };
            return chain;
          },
          rpc: async () => ({ data: [{ success: true }], error: null }),
        }) as unknown as SupabaseAdminClient,
      createStripe: () =>
        ({
          ephemeralKeys: { create: async () => ({ secret: 'ek_secret' }) },
          paymentIntents: {
            create: async () => {
              throw new Error('Your card was declined.');
            },
          },
        }) as unknown as ReturnIntentStripeClient,
    });

    expect(await result(await handler(request()))).toEqual({
      status: 400,
      body: { error: 'Your card was declined.' },
    });
  });
});
