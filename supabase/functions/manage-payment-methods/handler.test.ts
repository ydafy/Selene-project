import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import {
  createManagePaymentMethodsHandler,
  type PaymentMethodsStripe,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type Query = { table: string; ops: unknown[][] };
type Result = { data?: unknown; error?: unknown };

const USER_ID = '00000000-0000-4000-8000-0000000000b1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000b2';
const TOKEN = 'buyer-access-token';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  SUPABASE_URL: 'https://project.supabase.co',
};

const ALL_SAVED_CARDS = ['always', 'limited', 'unspecified'];

// A recording Supabase client: `respond` answers each query once its chain settles, and
// `events` lists token checks and table reads in order.
function fakeSupabase(
  respond: (query: Query) => Result,
  authError: unknown = null,
) {
  const events: string[] = [];
  const queries: Query[] = [];
  const users: Record<string, Row> = {
    [TOKEN]: { id: USER_ID, email: 'buyer@example.test' },
  };
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
      for (const op of ['select', 'eq', 'is', 'order', 'update', 'insert']) {
        chain[op] = (...args: unknown[]) => {
          query.ops.push([op, ...args]);
          return chain;
        };
      }
      for (const op of ['single', 'maybeSingle']) {
        chain[op] = () => {
          query.ops.push([op]);
          return settle();
        };
      }
      return chain;
    },
    rpc: (name: string) => {
      events.push(`rpc:${name}`);
      throw new Error('unexpected rpc');
    },
  };
  return { client: client as unknown as SupabaseAdminClient, events, queries };
}

// Only profiles_private exists for this function; any other table is a test failure.
const database = (input: { customerId?: string | null } = {}) =>
  fakeSupabase((query) => {
    if (query.table !== 'profiles_private') {
      throw new Error(`unexpected table ${query.table}`);
    }
    return query.ops[0][0] === 'update'
      ? { error: null }
      : {
          data: {
            stripe_customer_id:
              'customerId' in input ? input.customerId : 'cus_1',
          },
        };
  });

function fakeStripe(
  input: {
    sessionError?: Error;
    sessionSecret?: string;
    setupIntentError?: Error;
    setupIntentSecret?: string | null;
  } = {},
) {
  const calls: unknown[][] = [];
  const stripe: PaymentMethodsStripe = {
    customers: {
      create: async (params) => {
        calls.push(['customers.create', params]);
        return { id: 'cus_new' };
      },
    },
    customerSessions: {
      create: async (params) => {
        calls.push(['customerSessions.create', params]);
        if (input.sessionError) throw input.sessionError;
        return { client_secret: input.sessionSecret ?? 'cuss_secret' };
      },
    },
    setupIntents: {
      create: async (params, options) => {
        calls.push(['setupIntents.create', params, options]);
        if (input.setupIntentError) throw input.setupIntentError;
        return {
          client_secret:
            'setupIntentSecret' in input
              ? (input.setupIntentSecret ?? null)
              : 'seti_secret',
        };
      },
    },
  };
  return { stripe, calls };
}

function harness(
  input: {
    db?: ReturnType<typeof fakeSupabase>;
    stripe?: ReturnType<typeof fakeStripe>;
    env?: Record<string, string | undefined>;
    secretKey?: string;
  } = {},
) {
  const db = input.db ?? database();
  const stripe = input.stripe ?? fakeStripe();
  const env = { ...ENV, ...input.env };
  const created: unknown[][] = [];
  const handler = createManagePaymentMethodsHandler({
    getEnv: (name) => env[name],
    readSupabaseSecretKey: () =>
      'secretKey' in input ? input.secretKey : 'sb_secret_x',
    createStripe: (secret) => {
      created.push(['stripe', secret]);
      return stripe.stripe;
    },
    createSupabaseAdmin: (url, key) => {
      created.push(['supabase', url, key]);
      return db.client;
    },
  });
  return { handler, db, stripe, created };
}

const request = (
  body: unknown,
  init: { authorization?: string | null; idempotencyKey?: string } = {},
) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const authorization =
    init.authorization === undefined ? `Bearer ${TOKEN}` : init.authorization;
  if (authorization !== null) headers.set('Authorization', authorization);
  if (init.idempotencyKey) headers.set('idempotency-key', init.idempotencyKey);
  return new Request(
    'https://example.test/functions/v1/manage-payment-methods',
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
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
  ops: [['select', 'stripe_customer_id'], ['eq', 'id', USER_ID], ['single']],
};

const CUSTOMER_SHEET_SESSION = (customer: string) => [
  'customerSessions.create',
  {
    customer,
    components: {
      customer_sheet: {
        enabled: true,
        features: {
          payment_method_remove: 'enabled',
          payment_method_allow_redisplay_filters: ALL_SAVED_CARDS,
        },
      },
    },
  },
];

describe('manage-payment-methods handler', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore: () => void }).mockRestore();
  });

  it('builds the clients from the configured URL and secrets', async () => {
    const { handler, created } = harness();

    await handler(request({ action: 'create_customer_session' }));

    expect(created).toEqual([
      ['stripe', 'sk_test_x'],
      ['supabase', 'https://project.supabase.co', 'sb_secret_x'],
    ]);
  });

  it('builds the clients with empty strings when the configuration is missing', async () => {
    const { handler, created } = harness({
      env: { STRIPE_SECRET_KEY: undefined, SUPABASE_URL: undefined },
      secretKey: undefined,
    });

    await handler(request({ action: 'create_customer_session' }));

    expect(created).toEqual([
      ['stripe', ''],
      ['supabase', '', ''],
    ]);
  });

  it('answers 401 AUTH_REQUIRED without an Authorization header, before any table or Stripe call', async () => {
    const { handler, db, stripe } = harness();

    await expectJson(
      await handler(
        request({ action: 'create_customer_session' }, { authorization: null }),
      ),
      401,
      { error: 'AUTH_REQUIRED' },
    );
    expect(db.events).toEqual([]);
    expect(stripe.calls).toEqual([]);
  });

  it('answers 401 AUTH_REQUIRED for a token the auth server rejects, before any table or Stripe call', async () => {
    const { handler, db, stripe } = harness();

    await expectJson(
      await handler(
        request(
          { action: 'create_setup_intent' },
          { authorization: 'Bearer stolen-token' },
        ),
      ),
      401,
      { error: 'AUTH_REQUIRED' },
    );
    expect(db.events).toEqual(['auth:stolen-token']);
    expect(stripe.calls).toEqual([]);
  });

  it('answers 401 AUTH_REQUIRED when the auth server reports an error, even with a user object', async () => {
    const db = fakeSupabase(() => ({}), { message: 'jwt expired' });
    const { handler, stripe } = harness({ db });

    await expectJson(
      await handler(request({ action: 'create_customer_session' })),
      401,
      { error: 'AUTH_REQUIRED' },
    );
    expect(db.events).toEqual([`auth:${TOKEN}`]);
    expect(stripe.calls).toEqual([]);
  });

  for (const action of [
    'list_payment_methods',
    'delete_payment_method',
    'get_setup_config',
    'drop_everything',
  ]) {
    it(`rejects the action ${action} with 400 before any table or Stripe call`, async () => {
      const { handler, db, stripe } = harness();

      const response = await handler(
        request({
          action,
          paymentMethodId: '00000000-0000-4000-8000-0000000000c1',
        }),
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(JSON.parse(body.error)).toMatchObject([
        { code: 'invalid_value', path: ['action'] },
      ]);
      expect(db.events).toEqual([`auth:${TOKEN}`]);
      expect(stripe.calls).toEqual([]);
    });
  }

  it('creates and stores a Stripe customer for the verified user when the profile has none', async () => {
    const { handler, db, stripe } = harness({
      db: database({ customerId: null }),
    });

    await expectJson(
      await handler(
        request({ action: 'create_customer_session', userId: OTHER_ID }),
      ),
      200,
      { customerId: 'cus_new', customerSessionClientSecret: 'cuss_secret' },
    );
    expect(stripe.calls).toEqual([
      [
        'customers.create',
        {
          email: 'buyer@example.test',
          metadata: { supabase_user_id: USER_ID },
        },
      ],
      CUSTOMER_SHEET_SESSION('cus_new'),
    ]);
    expect(db.queries).toEqual([
      PROFILE_LOOKUP,
      {
        table: 'profiles_private',
        ops: [
          ['update', { stripe_customer_id: 'cus_new' }],
          ['eq', 'id', USER_ID],
        ],
      },
    ]);
  });

  describe('create_customer_session', () => {
    it("returns a CustomerSheet session for the verified user's stored customer, reading only the profile", async () => {
      const { handler, db, stripe } = harness();

      await expectJson(
        await handler(request({ action: 'create_customer_session' })),
        200,
        { customerId: 'cus_1', customerSessionClientSecret: 'cuss_secret' },
      );
      expect(db.queries).toEqual([PROFILE_LOOKUP]);
      expect(stripe.calls).toEqual([CUSTOMER_SHEET_SESSION('cus_1')]);
    });

    it('answers 500 CUSTOMER_SESSION_FAILED when Stripe refuses the session, with no fallback list', async () => {
      const { handler, db } = harness({
        stripe: fakeStripe({ sessionError: new Error('No such customer') }),
      });

      await expectJson(
        await handler(request({ action: 'create_customer_session' })),
        500,
        { error: 'CUSTOMER_SESSION_FAILED' },
      );
      expect(db.queries).toEqual([PROFILE_LOOKUP]);
    });

    it('answers 500 CUSTOMER_SESSION_FAILED when the session has no client secret', async () => {
      const { handler } = harness({
        stripe: fakeStripe({ sessionSecret: '' }),
      });

      await expectJson(
        await handler(request({ action: 'create_customer_session' })),
        500,
        { error: 'CUSTOMER_SESSION_FAILED' },
      );
    });
  });

  describe('create_setup_intent', () => {
    it("creates an on-session card SetupIntent for the verified user's customer, with no card limit", async () => {
      const { handler, db, stripe } = harness();

      await expectJson(
        await handler(
          request(
            { action: 'create_setup_intent' },
            { idempotencyKey: 'setup-key-1' },
          ),
        ),
        200,
        { setupIntentClientSecret: 'seti_secret' },
      );
      expect(db.queries).toEqual([PROFILE_LOOKUP]);
      expect(stripe.calls).toEqual([
        [
          'setupIntents.create',
          {
            customer: 'cus_1',
            allowed_payment_method_types: ['card'],
            usage: 'on_session',
            metadata: { user_id: USER_ID, app_name: 'selene' },
          },
          { idempotencyKey: 'setup-key-1' },
        ],
      ]);
    });

    it('uses a random idempotency key when the request sends none', async () => {
      const { handler, stripe } = harness();

      expect(
        (await handler(request({ action: 'create_setup_intent' }))).status,
      ).toBe(200);
      const options = stripe.calls.find(
        ([call]) => call === 'setupIntents.create',
      )?.[2] as { idempotencyKey: string };
      expect(options.idempotencyKey).toMatch(UUID);
    });

    it('answers 500 SETUP_INTENT_FAILED when Stripe refuses the SetupIntent', async () => {
      const { handler } = harness({
        stripe: fakeStripe({ setupIntentError: new Error('rate limited') }),
      });

      await expectJson(
        await handler(request({ action: 'create_setup_intent' })),
        500,
        { error: 'SETUP_INTENT_FAILED' },
      );
    });

    it('answers 500 SETUP_INTENT_FAILED when the SetupIntent has no client secret', async () => {
      const { handler } = harness({
        stripe: fakeStripe({ setupIntentSecret: null }),
      });

      await expectJson(
        await handler(request({ action: 'create_setup_intent' })),
        500,
        { error: 'SETUP_INTENT_FAILED' },
      );
    });
  });
});
