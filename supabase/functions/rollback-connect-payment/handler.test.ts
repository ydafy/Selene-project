import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  createRollbackConnectPaymentHandler,
  type RollbackConnectPaymentDependencies,
  type RollbackStripeClient,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;

const BUYER_ID = '00000000-0000-4000-8000-0000000000b1';
const OTHER_BUYER_ID = '00000000-0000-4000-8000-0000000000b2';
const TOKEN = 'buyer-access-token';
const ORDER_ID = 'order_1';
const OTHER_ORDER_ID = 'order_2';

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_rollback',
  SUPABASE_URL: 'http://127.0.0.1:54321',
};
const SECRET_KEY = 'sb_secret_rollback';

interface FakeIntent {
  status: string;
  metadata: Record<string, string>;
}

const intent = (status: string, productIds: string[] = []): FakeIntent => ({
  status,
  metadata: {
    buyer_id: BUYER_ID,
    order_id: ORDER_ID,
    ...(productIds.length ? { product_ids: JSON.stringify(productIds) } : {}),
  },
});

// Records, in order, every auth check, RPC and Stripe call the handler makes.
function harness(
  input: {
    env?: Record<string, string | undefined>;
    secretKey?: string;
    users?: Record<string, string>;
    authError?: string;
    intents?: Record<string, FakeIntent>;
    rpcResult?: { data: unknown; error: { message: string } | null };
    cancelError?: string;
  } = {},
) {
  const env = input.env ?? ENV;
  const users = input.users ?? { [TOKEN]: BUYER_ID };
  const intents = input.intents ?? {};
  const calls: string[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const refunds: Array<{ params: Row; options: Row }> = [];
  const cancels: string[] = [];
  const clients: Array<{ url: string; key: string }> = [];
  const stripeSecrets: string[] = [];

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
      throw new Error(`unexpected table read: ${table}`);
    },
    rpc: async (name: string, args: Row) => {
      calls.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      return input.rpcResult ?? { data: [{ success: true }], error: null };
    },
  };

  const stripe = {
    paymentIntents: {
      retrieve: async (id: string) => {
        calls.push(`stripe:retrieve:${id}`);
        const found = intents[id];
        if (!found) throw new Error(`No such payment_intent: '${id}'`);
        return { id, ...found };
      },
      cancel: async (id: string) => {
        calls.push(`stripe:cancel:${id}`);
        if (input.cancelError) throw new Error(input.cancelError);
        cancels.push(id);
        return { id, status: 'canceled' };
      },
    },
    refunds: {
      create: async (params: Row, options: Row) => {
        calls.push(`stripe:refund:${String(params.payment_intent)}`);
        refunds.push({ params, options });
        return { id: `re_${String(params.payment_intent)}` };
      },
    },
  };

  const deps: RollbackConnectPaymentDependencies = {
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
      return stripe as unknown as RollbackStripeClient;
    },
  };

  return {
    handler: createRollbackConnectPaymentHandler(deps),
    calls,
    rpcCalls,
    refunds,
    cancels,
    clients,
    stripeSecrets,
  };
}

const request = (
  body: unknown,
  authorization: string | null = `Bearer ${TOKEN}`,
) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authorization !== null) headers.set('Authorization', authorization);
  return new Request(
    'https://example.test/functions/v1/rollback-connect-payment',
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
};

const failure = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as {
    success: boolean;
    rolledBack: number;
    error: string;
  },
});

const isMutation = (call: string) =>
  call.startsWith('rpc:') ||
  call.startsWith('stripe:refund') ||
  call.startsWith('stripe:cancel');

let logs: string[] = [];

describe('rollback-connect-payment handler', () => {
  beforeEach(() => {
    logs = [];
    spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore: () => void }).mockRestore();
  });

  it.each([
    ['STRIPE_SECRET_KEY', { ...ENV, STRIPE_SECRET_KEY: undefined }, SECRET_KEY],
    ['SUPABASE_URL', { ...ENV, SUPABASE_URL: undefined }, SECRET_KEY],
    ['the secret key', ENV, undefined],
  ])(
    'answers 400 MISSING_SERVER_CONFIG without %s before any client exists',
    async (_missing, env, secretKey) => {
      const h = harness({ env, secretKey });

      const response = await failure(
        await h.handler(
          request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }),
        ),
      );

      expect(response).toEqual({
        status: 400,
        body: { success: false, rolledBack: 0, error: 'MISSING_SERVER_CONFIG' },
      });
      expect(h.calls).toEqual([]);
    },
  );

  it('answers 401 AUTH_REQUIRED without an Authorization header before creating any client', async () => {
    const h = harness({ intents: { pi_1: intent('succeeded', ['p1']) } });

    const response = await failure(
      await h.handler(
        request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }, null),
      ),
    );

    expect(response).toEqual({
      status: 401,
      body: { success: false, rolledBack: 0, error: 'AUTH_REQUIRED' },
    });
    expect(h.calls).toEqual([]);
  });

  it('answers 401 AUTH_REQUIRED for a token that is not a user, before any Stripe call or RPC', async () => {
    const h = harness({ intents: { pi_1: intent('succeeded', ['p1']) } });

    const response = await failure(
      await h.handler(
        request(
          { orderId: ORDER_ID, paymentIntentIds: ['pi_1'] },
          'Bearer anon-key',
        ),
      ),
    );

    expect(response).toEqual({
      status: 401,
      body: { success: false, rolledBack: 0, error: 'AUTH_REQUIRED' },
    });
    expect(h.calls).toEqual(['client', 'auth:anon-key']);
  });

  it('answers 401 when the auth server reports an error, even with a user object', async () => {
    const h = harness({
      authError: 'jwt expired',
      intents: { pi_1: intent('succeeded', ['p1']) },
    });

    const response = await failure(
      await h.handler(
        request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }),
      ),
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('AUTH_REQUIRED');
    expect(h.calls).toEqual(['client', `auth:${TOKEN}`]);
  });

  it('builds the admin client from SUPABASE_URL and the secret key, and Stripe from STRIPE_SECRET_KEY', async () => {
    const h = harness({ intents: { pi_1: intent('processing') } });

    await h.handler(request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }));

    expect(h.clients).toEqual([{ url: ENV.SUPABASE_URL, key: SECRET_KEY }]);
    expect(h.stripeSecrets).toEqual([ENV.STRIPE_SECRET_KEY]);
  });

  it.each([
    ['no ids', { orderId: ORDER_ID, paymentIntentIds: [] }, 'too_small'],
    [
      '21 ids',
      {
        orderId: ORDER_ID,
        paymentIntentIds: Array.from({ length: 21 }, (_, i) => `pi_${i}`),
      },
      'too_big',
    ],
    ['no order id', { paymentIntentIds: ['pi_1'] }, 'invalid_type'],
    ['a body that is not JSON', 'not json', 'invalid_type'],
  ])(
    'parses the body with RollbackConnectPaymentRequestSchema after authentication (%s: %s)',
    async (_label, body, code) => {
      const h = harness({ intents: { pi_1: intent('succeeded', ['p1']) } });

      const response = await failure(await h.handler(request(body)));

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.rolledBack).toBe(0);
      expect(
        JSON.parse(response.body.error).map(
          (issue: { code: string }) => issue.code,
        ),
      ).toContain(code);
      expect(h.calls).toEqual(['client', `auth:${TOKEN}`]);
    },
  );

  it('refuses every intent when one belongs to another buyer, before any refund, cancel or release', async () => {
    const h = harness({
      intents: {
        pi_1: intent('succeeded', ['p1']),
        pi_2: {
          status: 'requires_payment_method',
          metadata: {
            buyer_id: OTHER_BUYER_ID,
            order_id: ORDER_ID,
            product_ids: '["p2"]',
          },
        },
      },
    });

    const response = await failure(
      await h.handler(
        request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1', 'pi_2'] }),
      ),
    );

    expect(response).toEqual({
      status: 400,
      body: {
        success: false,
        rolledBack: 0,
        error: 'PAYMENT_INTENT_NOT_OWNED_BY_USER',
      },
    });
    expect(h.calls.filter(isMutation)).toEqual([]);
  });

  it.each([
    ['a different order', { order_id: OTHER_ORDER_ID }],
    ['no order id', {}],
  ])(
    'refuses every intent when one carries %s in metadata, before any cancel or release',
    async (_label, orderMetadata) => {
      const h = harness({
        intents: {
          pi_1: intent('requires_payment_method', ['p1']),
          pi_2: {
            status: 'requires_payment_method',
            metadata: {
              buyer_id: BUYER_ID,
              ...orderMetadata,
              product_ids: '["p2"]',
            },
          },
        },
      });

      const response = await failure(
        await h.handler(
          request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1', 'pi_2'] }),
        ),
      );

      expect(response).toEqual({
        status: 400,
        body: {
          success: false,
          rolledBack: 0,
          error: 'PAYMENT_INTENT_ORDER_MISMATCH',
        },
      });
      expect(h.calls.filter(isMutation)).toEqual([]);
      expect(h.cancels).toEqual([]);
      expect(h.refunds).toEqual([]);
      expect(h.rpcCalls).toEqual([]);
    },
  );

  it('leaves a succeeded intent to the server path: no refund, cancel or release', async () => {
    const h = harness({ intents: { pi_1: intent('succeeded', ['p1', 'p2']) } });

    const response = await h.handler(
      request({
        orderId: ORDER_ID,
        paymentIntentIds: ['pi_1'],
        amount: 1,
        amountCents: 1,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, rolledBack: 0 });
    expect(h.calls).toEqual([
      'client',
      `auth:${TOKEN}`,
      'stripe',
      'stripe:retrieve:pi_1',
    ]);
    expect(h.refunds).toEqual([]);
    expect(h.cancels).toEqual([]);
    expect(h.rpcCalls).toEqual([]);
  });

  it('cancels only the open intent and releases only its products when the other one succeeded', async () => {
    const h = harness({
      intents: {
        pi_paid: intent('succeeded', ['p1', 'p2']),
        pi_open: intent('requires_payment_method', ['p2', 'p3']),
      },
    });

    const response = await h.handler(
      request({ orderId: ORDER_ID, paymentIntentIds: ['pi_paid', 'pi_open'] }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, rolledBack: 1 });
    expect(h.refunds).toEqual([]);
    expect(h.cancels).toEqual(['pi_open']);
    expect(h.rpcCalls).toEqual([
      { name: 'fn_release_products', args: { p_product_ids: ['p2', 'p3'] } },
    ]);
  });

  it.each([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
  ])('cancels an intent in %s instead of refunding it', async (status) => {
    const h = harness({ intents: { pi_1: intent(status, ['p1']) } });

    const response = await h.handler(
      request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }),
    );

    expect(await response.json()).toEqual({ success: true, rolledBack: 1 });
    expect(h.cancels).toEqual(['pi_1']);
    expect(h.refunds).toEqual([]);
    expect(h.rpcCalls).toEqual([
      { name: 'fn_release_products', args: { p_product_ids: ['p1'] } },
    ]);
  });

  it('leaves other states alone and releases only the products of rolled-back intents', async () => {
    const h = harness({
      intents: {
        pi_paid: intent('succeeded', ['p1', 'p2']),
        pi_open: intent('requires_action', ['p2', 'p3']),
        pi_processing: intent('processing', ['p4']),
        pi_canceled: intent('canceled', ['p5']),
        pi_capture: intent('requires_capture', ['p6']),
      },
    });

    const response = await h.handler(
      request({
        orderId: ORDER_ID,
        paymentIntentIds: [
          'pi_paid',
          'pi_open',
          'pi_processing',
          'pi_canceled',
          'pi_capture',
        ],
      }),
    );

    expect(await response.json()).toEqual({ success: true, rolledBack: 1 });
    expect(h.calls).toEqual([
      'client',
      `auth:${TOKEN}`,
      'stripe',
      'stripe:retrieve:pi_paid',
      'stripe:retrieve:pi_open',
      'stripe:retrieve:pi_processing',
      'stripe:retrieve:pi_canceled',
      'stripe:retrieve:pi_capture',
      'stripe:cancel:pi_open',
      'rpc:fn_release_products',
    ]);
    expect(h.rpcCalls).toEqual([
      {
        name: 'fn_release_products',
        args: { p_product_ids: ['p2', 'p3'] },
      },
    ]);
  });

  it('calls no RPC when nothing was rolled back', async () => {
    const h = harness({ intents: { pi_1: intent('processing', ['p1']) } });

    const response = await h.handler(
      request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }),
    );

    expect(await response.json()).toEqual({ success: true, rolledBack: 0 });
    expect(h.rpcCalls).toEqual([]);
  });

  it('still answers success after Stripe rolled back when the product release fails, and logs it', async () => {
    const h = harness({
      intents: { pi_1: intent('requires_payment_method', ['p1']) },
      rpcResult: { data: null, error: { message: 'release failed' } },
    });

    const response = await h.handler(
      request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, rolledBack: 1 });
    expect(logs.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        function: 'rollback-connect-payment',
        level: 'error',
        msg: 'Product release failed after Stripe rollback',
        orderId: ORDER_ID,
        productIds: ['p1'],
        error: 'release failed',
      }),
    );
  });

  it('logs an unsuccessful release row', async () => {
    const h = harness({
      intents: { pi_1: intent('requires_payment_method', ['p1']) },
      rpcResult: { data: [{ success: false }], error: null },
    });

    await h.handler(request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }));

    expect(logs.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        level: 'error',
        msg: 'Product release returned unsuccessful result',
      }),
    );
  });

  it('answers 400 with the Stripe message when a cancel fails, and releases nothing', async () => {
    const h = harness({
      intents: { pi_1: intent('requires_payment_method', ['p1']) },
      cancelError: 'payment_intent_unexpected_state',
    });

    const response = await failure(
      await h.handler(
        request({ orderId: ORDER_ID, paymentIntentIds: ['pi_1'] }),
      ),
    );

    expect(response).toEqual({
      status: 400,
      body: {
        success: false,
        rolledBack: 0,
        error: 'payment_intent_unexpected_state',
      },
    });
    expect(h.rpcCalls).toEqual([]);
  });
});
