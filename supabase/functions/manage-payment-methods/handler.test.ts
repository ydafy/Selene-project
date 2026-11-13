import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';
import {
  createManagePaymentMethodsHandler,
  type PaymentMethodsStripe,
  type SupabaseAdminClient,
} from './handler.ts';

type Row = Record<string, unknown>;
type Query = { table: string; ops: unknown[][] };
type Result = { data?: unknown; error?: unknown; count?: number | null };

const USER_ID = '00000000-0000-4000-8000-0000000000b1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000b2';
const PM_ID = '00000000-0000-4000-8000-0000000000c1';
const TOKEN = 'buyer-access-token';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  SUPABASE_URL: 'https://project.supabase.co',
};

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
        Promise.resolve({
          data: null,
          error: null,
          count: null,
          ...respond(query),
        });
      const chain: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
          settle().then(ok, ko),
      };
      for (const op of ['select', 'eq', 'is', 'order', 'update']) {
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

// Answers by table and first operation.
const database = (
  input: {
    customerId?: string | null;
    activeCount?: number | null;
    methods?: Row[] | null;
    owned?: Row | null;
    deleteError?: unknown;
  } = {},
) =>
  fakeSupabase((query) => {
    const first = query.ops[0];
    if (query.table === 'profiles_private') {
      return first[0] === 'update'
        ? { error: null }
        : {
            data: {
              stripe_customer_id:
                'customerId' in input ? input.customerId : 'cus_1',
            },
          };
    }
    if (first[0] === 'update') return { error: input.deleteError ?? null };
    if ((first[2] as { head?: boolean } | undefined)?.head) {
      return { count: input.activeCount ?? 0 };
    }
    if (query.ops.some(([op]) => op === 'maybeSingle')) {
      return {
        data:
          'owned' in input
            ? input.owned
            : { stripe_payment_method_id: 'pm_stripe_1' },
      };
    }
    return { data: 'methods' in input ? input.methods : [{ id: PM_ID }] };
  });

function fakeStripe(input: { detachError?: Error } = {}) {
  const calls: unknown[][] = [];
  const stripe: PaymentMethodsStripe = {
    customers: {
      create: async (params) => {
        calls.push(['customers.create', params]);
        return { id: 'cus_new' };
      },
    },
    ephemeralKeys: {
      create: async (params, options) => {
        calls.push(['ephemeralKeys.create', params, options]);
        return { secret: 'ek_secret' };
      },
    },
    setupIntents: {
      create: async (params, options) => {
        calls.push(['setupIntents.create', params, options]);
        return { client_secret: 'seti_secret' };
      },
    },
    paymentMethods: {
      detach: async (paymentMethodId) => {
        calls.push(['paymentMethods.detach', paymentMethodId]);
        if (input.detachError) throw input.detachError;
        return {};
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

describe('manage-payment-methods handler', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore: () => void }).mockRestore();
  });

  it('builds the clients from the configured URL and secrets', async () => {
    const { handler, created } = harness();

    await handler(request({ action: 'list_payment_methods' }));

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

    await handler(request({ action: 'list_payment_methods' }));

    expect(created).toEqual([
      ['stripe', ''],
      ['supabase', '', ''],
    ]);
  });

  it('answers 401 AUTH_REQUIRED without an Authorization header, before any table or Stripe call', async () => {
    const { handler, db, stripe } = harness();

    await expectJson(
      await handler(
        request({ action: 'list_payment_methods' }, { authorization: null }),
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
          { action: 'list_payment_methods' },
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
      await handler(request({ action: 'list_payment_methods' })),
      401,
      { error: 'AUTH_REQUIRED' },
    );
    expect(db.events).toEqual([`auth:${TOKEN}`]);
    expect(stripe.calls).toEqual([]);
  });

  it('rejects an unknown action with 400 before any table or Stripe call', async () => {
    const { handler, db, stripe } = harness();

    const response = await handler(request({ action: 'drop_everything' }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(JSON.parse(body.error)).toMatchObject([
      { code: 'invalid_value', path: ['action'] },
    ]);
    expect(db.events).toEqual([`auth:${TOKEN}`]);
    expect(stripe.calls).toEqual([]);
  });

  it('creates and stores a Stripe customer for the verified user when the profile has none', async () => {
    const { handler, db, stripe } = harness({
      db: database({ customerId: null }),
    });

    const response = await handler(
      request({ action: 'list_payment_methods', userId: OTHER_ID }),
    );

    expect(response.status).toBe(200);
    expect(stripe.calls).toEqual([
      [
        'customers.create',
        {
          email: 'buyer@example.test',
          metadata: { supabase_user_id: USER_ID },
        },
      ],
    ]);
    expect(db.queries.slice(0, 2)).toEqual([
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

  describe('get_setup_config', () => {
    it('returns a setup intent and ephemeral key for the stored customer', async () => {
      const { handler, db, stripe } = harness({
        db: database({ activeCount: 2 }),
      });

      await expectJson(
        await handler(
          request(
            { action: 'get_setup_config' },
            { idempotencyKey: 'setup-key-1' },
          ),
        ),
        200,
        {
          setupIntent: 'seti_secret',
          ephemeralKey: 'ek_secret',
          customer: 'cus_1',
          publishableKey: 'pk_test_x',
        },
      );
      expect(db.queries).toEqual([
        PROFILE_LOOKUP,
        {
          table: 'payment_methods',
          ops: [
            ['select', '*', { count: 'exact', head: true }],
            ['eq', 'user_id', USER_ID],
            ['is', 'deleted_at', null],
          ],
        },
      ]);
      expect(stripe.calls).toEqual([
        [
          'ephemeralKeys.create',
          { customer: 'cus_1' },
          { apiVersion: STRIPE_API_VERSION },
        ],
        [
          'setupIntents.create',
          {
            customer: 'cus_1',
            allowed_payment_method_types: ['card'],
            metadata: { user_id: USER_ID, app_name: 'selene' },
          },
          { idempotencyKey: 'setup-key-1' },
        ],
      ]);
    });

    it('uses a random idempotency key when the request sends none', async () => {
      const { handler, stripe } = harness();

      expect(
        (await handler(request({ action: 'get_setup_config' }))).status,
      ).toBe(200);
      const options = stripe.calls.find(
        ([call]) => call === 'setupIntents.create',
      )?.[2] as { idempotencyKey: string };
      expect(options.idempotencyKey).toMatch(UUID);
    });

    it('answers 400 PAYMENT_LIMIT_REACHED at three active cards, with no Stripe call', async () => {
      const { handler, stripe } = harness({ db: database({ activeCount: 3 }) });

      await expectJson(
        await handler(request({ action: 'get_setup_config' })),
        400,
        { error: 'PAYMENT_LIMIT_REACHED' },
      );
      expect(stripe.calls).toEqual([]);
    });
  });

  describe('list_payment_methods', () => {
    it("lists the verified user's active cards, newest first", async () => {
      const { handler, db, stripe } = harness();

      await expectJson(
        await handler(request({ action: 'list_payment_methods' })),
        200,
        { methods: [{ id: PM_ID }] },
      );
      expect(db.queries).toEqual([
        PROFILE_LOOKUP,
        {
          table: 'payment_methods',
          ops: [
            ['select', '*'],
            ['eq', 'user_id', USER_ID],
            ['is', 'deleted_at', null],
            ['order', 'created_at', { ascending: false }],
          ],
        },
      ]);
      expect(stripe.calls).toEqual([]);
    });

    it('answers an empty list when the read returns no data', async () => {
      const { handler } = harness({ db: database({ methods: null }) });

      await expectJson(
        await handler(request({ action: 'list_payment_methods' })),
        200,
        { methods: [] },
      );
    });
  });

  describe('delete_payment_method', () => {
    const OWNED_LOOKUP: Query = {
      table: 'payment_methods',
      ops: [
        ['select', 'stripe_payment_method_id'],
        ['eq', 'id', PM_ID],
        ['eq', 'user_id', USER_ID],
        ['is', 'deleted_at', null],
        ['maybeSingle'],
      ],
    };

    it('answers 400 PAYMENT_METHOD_ID_REQUIRED without an id, before reading cards', async () => {
      const { handler, db, stripe } = harness();

      await expectJson(
        await handler(request({ action: 'delete_payment_method' })),
        400,
        { error: 'PAYMENT_METHOD_ID_REQUIRED' },
      );
      expect(db.queries).toEqual([PROFILE_LOOKUP]);
      expect(stripe.calls).toEqual([]);
    });

    it("detaches the verified user's card in Stripe and soft-deletes it", async () => {
      const { handler, db, stripe } = harness();

      await expectJson(
        await handler(
          request({ action: 'delete_payment_method', paymentMethodId: PM_ID }),
        ),
        200,
        { success: true },
      );
      expect(stripe.calls).toEqual([['paymentMethods.detach', 'pm_stripe_1']]);
      expect(db.queries.slice(0, 2)).toEqual([PROFILE_LOOKUP, OWNED_LOOKUP]);
      const softDelete = db.queries[2];
      expect(softDelete.table).toBe('payment_methods');
      expect(softDelete.ops).toEqual([
        ['update', { deleted_at: expect.stringMatching(ISO) }],
        ['eq', 'id', PM_ID],
      ]);
    });

    it('answers success without Stripe or a write when the card is not an active card of the user', async () => {
      const { handler, db, stripe } = harness({
        db: database({ owned: null }),
      });

      await expectJson(
        await handler(
          request({ action: 'delete_payment_method', paymentMethodId: PM_ID }),
        ),
        200,
        { success: true, message: 'Already deleted' },
      );
      expect(db.queries).toEqual([PROFILE_LOOKUP, OWNED_LOOKUP]);
      expect(stripe.calls).toEqual([]);
    });

    it('still soft-deletes when the Stripe detach fails', async () => {
      const { handler, db } = harness({
        stripe: fakeStripe({
          detachError: new Error('No such payment method'),
        }),
      });

      await expectJson(
        await handler(
          request({ action: 'delete_payment_method', paymentMethodId: PM_ID }),
        ),
        200,
        { success: true },
      );
      expect(db.queries[2].ops[0][0]).toBe('update');
    });

    it('answers 400 DB_DELETE_FAILED when the soft delete fails', async () => {
      const { handler } = harness({
        db: database({ deleteError: { message: 'denied' } }),
      });

      await expectJson(
        await handler(
          request({ action: 'delete_payment_method', paymentMethodId: PM_ID }),
        ),
        400,
        { error: 'DB_DELETE_FAILED: denied' },
      );
    });
  });
});
