import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import Stripe from 'stripe';

import { STRIPE_API_VERSION } from '../_shared/stripe/api-version';
import { SINGLE_MODAL_FLOW } from '../create-connect-payment/single-payment-builder';
import {
  createStripeWebhooksHandler,
  type StripeWebhooksStripeClient,
  type SupabaseAdminClient,
} from './handler';

const PLATFORM_SECRET = 'whsec_platform_test';
const CONNECT_SECRET = 'whsec_connect_test';
const SUPABASE_URL = 'http://supabase.test';
const SUPABASE_KEY = 'sb_secret_test';
const STRIPE_KEY = 'sk_test_webhooks';

// The real SDK signs and verifies, so its own verification (scheme and
// 300 s tolerance) runs; every other Stripe API is faked below.
// Bun loads the SDK's Web Crypto build, which signs only asynchronously.
const signatureHeader = (
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) =>
  Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    timestamp,
  });

type Result = { data?: unknown; error?: { message: string } | null };
type Query = { table: string; ops: unknown[][] };
type Rpc = { name: string; args: Record<string, unknown> };
type StripeCall = { method: string; args: unknown[] };

interface Options {
  env?: Record<string, string | undefined>;
  /** RPC answers by name; a function gets the call arguments. */
  rpc?: Record<string, Result | ((args: Record<string, unknown>) => Result)>;
  /** Table answers; the default is `{ data: null, error: null }`. */
  table?: (query: Query) => Result | undefined;
  /** Stripe answers by method name (`charges.retrieve`, ...). */
  stripe?: Record<string, (...args: unknown[]) => unknown>;
  /** `stripe-signature` header; `null` sends none. Defaults to a valid one. */
  signature?: string | null;
  secret?: string;
  /** Signs the default header this many seconds in the past. */
  signedSecondsAgo?: number;
  reportMessage?: () => Promise<void>;
}

async function invoke(event: unknown, options: Options = {}) {
  const env: Record<string, string | undefined> = {
    STRIPE_SECRET_KEY: STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET: PLATFORM_SECRET,
    STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET,
    SUPABASE_URL,
    ...options.env,
  };
  // Every client creation, query, RPC, Stripe call and report, in order.
  const effects: string[] = [];
  const queries: Query[] = [];
  const rpcs: Rpc[] = [];
  const stripeCalls: StripeCall[] = [];
  const clients: unknown[][] = [];
  const stripeSecrets: string[] = [];
  const reports: unknown[][] = [];
  const verifications: string[] = [];

  const from = (table: string) => {
    const query: Query = { table, ops: [] };
    queries.push(query);
    effects.push(`from:${table}`);
    const result = () =>
      Promise.resolve({
        data: null,
        error: null,
        ...options.table?.(query),
      });
    const chain: Record<string, unknown> = {};
    for (const op of [
      'select',
      'eq',
      'is',
      'in',
      'update',
      'upsert',
      'insert',
    ]) {
      chain[op] = (...args: unknown[]) => {
        query.ops.push([op, ...args]);
        return chain;
      };
    }
    for (const op of ['single', 'maybeSingle']) {
      chain[op] = () => {
        query.ops.push([op]);
        return result();
      };
    }
    chain.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => result().then(resolve, reject);
    return chain;
  };
  const supabase = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      effects.push(`rpc:${name}`);
      const answer = options.rpc?.[name];
      const result =
        typeof answer === 'function' ? answer(args) : (answer ?? {});
      return { data: null, error: null, ...result };
    },
  };

  const stripeMethod =
    (method: string) =>
    async (...args: unknown[]) => {
      stripeCalls.push({ method, args });
      effects.push(`stripe:${method}`);
      const answer = options.stripe?.[method];
      if (!answer) throw new Error(`Unexpected Stripe call: ${method}`);
      return answer(...args);
    };
  const stripe = {
    webhooks: {
      constructEventAsync: (
        payload: string,
        header: string,
        secret: string,
      ) => {
        verifications.push(secret);
        return Stripe.webhooks.constructEventAsync(payload, header, secret);
      },
    },
    charges: { retrieve: stripeMethod('charges.retrieve') },
    refunds: { create: stripeMethod('refunds.create') },
    payouts: { retrieve: stripeMethod('payouts.retrieve') },
    accounts: {
      retrieve: stripeMethod('accounts.retrieve'),
      listExternalAccounts: stripeMethod('accounts.listExternalAccounts'),
    },
    paymentMethods: { retrieve: stripeMethod('paymentMethods.retrieve') },
  };

  const handler = createStripeWebhooksHandler({
    getEnv: (name) => env[name],
    readSupabaseSecretKey: () => SUPABASE_KEY,
    createSupabaseAdmin: (url, key) => {
      clients.push([url, key]);
      effects.push('supabase');
      return supabase as unknown as SupabaseAdminClient;
    },
    createStripe: (secret) => {
      stripeSecrets.push(secret);
      return stripe as unknown as StripeWebhooksStripeClient;
    },
    reportMessage: async (...args: unknown[]) => {
      reports.push(args);
      effects.push('report');
      await options.reportMessage?.();
    },
  });

  const payload =
    typeof event === 'string' ? event : JSON.stringify(event ?? null);
  const headers = new Headers();
  const signature =
    options.signature === undefined
      ? await signatureHeader(
          payload,
          options.secret ?? PLATFORM_SECRET,
          Math.floor(Date.now() / 1000) - (options.signedSecondsAgo ?? 0),
        )
      : options.signature;
  if (signature !== null) headers.set('stripe-signature', signature);
  const response = await handler(
    new Request('http://localhost/functions/v1/stripe-webhooks', {
      method: 'POST',
      headers,
      body: payload,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: (() => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    })(),
    effects,
    queries,
    rpcs,
    stripeCalls,
    clients,
    stripeSecrets,
    reports,
    verifications,
    dlq: queries
      .filter((query) => query.table === 'webhook_dlq')
      .map((query) => query.ops[0]?.[1]),
  };
}

let logs: Array<Record<string, unknown>> = [];
let logSpy: ReturnType<typeof spyOn> | undefined;
beforeEach(() => {
  logs = [];
  logSpy = spyOn(console, 'log').mockImplementation((line: unknown) => {
    logs.push(JSON.parse(String(line)) as Record<string, unknown>);
  });
});
afterEach(() => logSpy?.mockRestore());
const logged = (msg: string) => logs.filter((entry) => entry.msg === msg);

let eventCounter = 0;
const stripeEvent = (
  type: string,
  object: unknown,
  extra: Record<string, unknown> = {},
) => ({
  id: `evt_${++eventCounter}`,
  object: 'event',
  type,
  api_version: STRIPE_API_VERSION,
  created: 1_782_000_000,
  data: { object },
  ...extra,
});

// The DLQ answer for a failed event: 500, the message, and one DLQ row.
function expectDlq(
  result: Awaited<ReturnType<typeof invoke>>,
  event: { type: string },
  message: string,
) {
  expect(result.status).toBe(500);
  expect(result.body).toEqual({ error: message });
  expect(result.dlq).toEqual([
    {
      event_type: event.type,
      payload: JSON.parse(JSON.stringify(event)),
      error_message: message,
    },
  ]);
  expect(result.clients).toEqual([
    [SUPABASE_URL, SUPABASE_KEY],
    [SUPABASE_URL, SUPABASE_KEY],
  ]);
}

describe('signature verification comes before any effect', () => {
  const event = stripeEvent('payment_intent.payment_failed', {
    id: 'pi_1',
    metadata: { app_name: 'selene', product_ids: '["p1"]' },
  });

  it('creates the Stripe client once from STRIPE_SECRET_KEY and the Supabase client only after verification', async () => {
    const result = await invoke(event);
    expect(result.status).toBe(200);
    expect(result.stripeSecrets).toEqual([STRIPE_KEY]);
    expect(result.verifications).toEqual([PLATFORM_SECRET]);
    expect(result.clients).toEqual([[SUPABASE_URL, SUPABASE_KEY]]);
    expect(result.effects).toEqual(['supabase', 'rpc:fn_release_products']);
  });

  it('accepts an event signed with the Connect secret', async () => {
    const result = await invoke(event, { secret: CONNECT_SECRET });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(result.verifications).toEqual([PLATFORM_SECRET, CONNECT_SECRET]);
  });

  it('accepts a signature inside the 300 s tolerance', async () => {
    const result = await invoke(event, { signedSecondsAgo: 200 });
    expect(result.status).toBe(200);
    expect(result.effects).toEqual(['supabase', 'rpc:fn_release_products']);
  });

  const rejected: Array<[string, Options, number, string, string]> = [
    [
      'no stripe-signature header',
      { signature: null },
      400,
      'No signature',
      '',
    ],
    [
      'a signature from another secret',
      { secret: 'whsec_other' },
      400,
      'Invalid signature',
      'invalid_signature',
    ],
    [
      'a signature older than the tolerance',
      { signedSecondsAgo: 600 },
      400,
      'Invalid signature',
      'invalid_signature',
    ],
    [
      'a malformed signature header',
      { signature: 't=1,v1=not-a-signature' },
      400,
      'Invalid signature',
      'invalid_signature',
    ],
    [
      'no configured webhook secret',
      {
        env: {
          STRIPE_WEBHOOK_SECRET: undefined,
          STRIPE_CONNECT_WEBHOOK_SECRET: '',
        },
      },
      500,
      'Webhook secret not configured',
      'missing_secret',
    ],
  ];
  for (const [label, options, status, text, reason] of rejected) {
    it(`rejects ${label} with no database, Stripe or Sentry effect`, async () => {
      const drifted = { ...event, api_version: '2020-08-27' };
      const result = await invoke(drifted, options);
      expect(result.status).toBe(status);
      expect(result.text).toBe(text);
      expect(result.effects).toEqual([]);
      expect(result.clients).toEqual([]);
      expect(result.reports).toEqual([]);
      if (reason) {
        expect(
          logged('Rejected Stripe webhook with unverifiable signature'),
        ).toEqual([
          expect.objectContaining({
            level: reason === 'missing_secret' ? 'CRITICAL' : 'ERROR',
            reason,
          }),
        ]);
      }
    });
  }

  it('rejects a body changed after signing', async () => {
    const payload = JSON.stringify(event);
    const result = await invoke(payload.replace('pi_1', 'pi_2'), {
      signature: await signatureHeader(payload, PLATFORM_SECRET),
    });
    expect(result.status).toBe(400);
    expect(result.effects).toEqual([]);
  });
});

describe('API version drift', () => {
  const failed = (apiVersion: unknown) =>
    stripeEvent(
      'payment_intent.payment_failed',
      { id: 'pi_1', metadata: { app_name: 'selene', product_ids: '["p1"]' } },
      { api_version: apiVersion },
    );

  it('reports a drifted event after verification and still processes it', async () => {
    const result = await invoke(failed('2025-12-15.clover'));
    expect(result.status).toBe(200);
    expect(result.effects).toEqual([
      'report',
      'supabase',
      'rpc:fn_release_products',
    ]);
    expect(logged('Stripe event API version drift')).toHaveLength(1);
  });

  it('still processes the event when Sentry fails', async () => {
    const result = await invoke(failed('2025-12-15.clover'), {
      reportMessage: async () => {
        throw new Error('sentry down');
      },
    });
    expect(result.status).toBe(200);
    expect(result.rpcs.map((rpc) => rpc.name)).toEqual(['fn_release_products']);
  });

  it('does not report an event in the pinned release line', async () => {
    const result = await invoke(failed(STRIPE_API_VERSION));
    expect(result.reports).toEqual([]);
    expect(logged('Stripe event API version drift')).toEqual([]);
  });
});

describe('payment_intent.payment_failed and payment_intent.canceled', () => {
  for (const type of [
    'payment_intent.payment_failed',
    'payment_intent.canceled',
  ]) {
    it(`${type} releases the reserved products of a Selene payment`, async () => {
      const result = await invoke(
        stripeEvent(type, {
          id: 'pi_1',
          metadata: { app_name: 'selene', product_ids: '["p1","p2"]' },
        }),
        { rpc: { fn_release_products: { error: { message: 'ignored' } } } },
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ received: true });
      expect(result.rpcs).toEqual([
        { name: 'fn_release_products', args: { p_product_ids: ['p1', 'p2'] } },
      ]);
    });
  }

  for (const [label, metadata] of [
    [
      'a return shipping payment',
      { app_name: 'selene', type: 'return_shipping', product_ids: '["p1"]' },
    ],
    ['another app', { app_name: 'other', product_ids: '["p1"]' }],
    ['no product ids', { app_name: 'selene' }],
  ] as const) {
    it(`releases nothing for ${label}`, async () => {
      const result = await invoke(
        stripeEvent('payment_intent.canceled', { id: 'pi_1', metadata }),
      );
      expect(result.status).toBe(200);
      expect(result.effects).toEqual(['supabase']);
    });
  }
});

describe('payment_intent.succeeded for a return shipping payment', () => {
  const event = stripeEvent('payment_intent.succeeded', {
    id: 'pi_return',
    amount: 15_050,
    metadata: { type: 'return_shipping', dispute_id: 'dispute-1' },
  });

  it('logs the return payment in pesos and acknowledges', async () => {
    const result = await invoke(event);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(result.rpcs).toEqual([
      {
        name: 'fn_log_return_payment',
        args: {
          p_dispute_id: 'dispute-1',
          p_stripe_id: 'pi_return',
          p_amount: 150.5,
        },
      },
    ]);
  });

  it('sends a failed log to the DLQ with 500', async () => {
    const result = await invoke(event, {
      rpc: { fn_log_return_payment: { error: { message: 'boom' } } },
    });
    expectDlq(result, event, 'Fallo en fn_log_return_payment: boom');
  });
});

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const ROW = {
  sellerId: 'cccccccc-0000-0000-0000-000000000001',
  shipmentId: 'dddddddd-0000-0000-0000-000000000011',
  productIds: ['eeeeeeee-0000-0000-0000-000000000001'],
  grossCents: 100_000,
  commissionCents: 6_000,
  shippingCents: 20_000,
  seguroCents: 3_900,
  netCents: 74_000,
};
const singleModalMetadata = (): Record<string, string> => ({
  app_name: 'selene',
  flow: SINGLE_MODAL_FLOW,
  transfer_group: `selene_order_${ORDER_ID}`,
  order_id: ORDER_ID,
  order_group_id: ORDER_ID,
  buyer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  address_id: 'bbbbbbbb-0000-0000-0000-000000000002',
  total_sellers: '1',
  buyer_total_cents: '103900',
  total_gross_cents: '100000',
  total_commission_cents: '6000',
  total_shipping_cents: '20000',
  total_seguro_cents: '3900',
  total_release_cents: '74000',
  allocation_chunk_count: '1',
  allocation_json_0: JSON.stringify({ rows: [ROW] }),
});
const succeeded = (intent: Record<string, unknown> = {}) =>
  stripeEvent('payment_intent.succeeded', {
    id: 'pi_single',
    amount: 103_900,
    latest_charge: 'ch_1',
    metadata: singleModalMetadata(),
    ...intent,
  });
const SETTLEMENT_ARGS = {
  p_stripe_payment_intent_id: 'pi_single',
  p_stripe_charge_id: 'ch_1',
  p_amount_received: 103_900,
  p_transfer_group: `selene_order_${ORDER_ID}`,
  p_allocation: {
    buyer_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    address_id: 'bbbbbbbb-0000-0000-0000-000000000002',
    order_id: ORDER_ID,
    order_group_id: ORDER_ID,
    total_amount: 1039,
    rows: [
      {
        seller_id: ROW.sellerId,
        shipment_id: ROW.shipmentId,
        product_ids: ROW.productIds,
        gross_cents: 100_000,
        commission_cents: 6_000,
        shipping_cents: 20_000,
        seguro_cents: 3_900,
        net_cents: 74_000,
      },
    ],
  },
};

// Order fee lookup, conditional fee update and refresh for a settled order.
const orderTable =
  (options: {
    order?: Result;
    updated?: Result;
    refreshed?: Result;
    job?: Result;
  }) =>
  (query: Query): Result | undefined => {
    const ops = query.ops.map(([op]) => op);
    if (query.table === 'stripe_fee_reconciliation_jobs') return options.job;
    if (query.table !== 'orders') return undefined;
    if (ops.includes('update')) {
      return options.updated ?? { data: [{ id: ORDER_ID }] };
    }
    if (
      query.ops.some(
        ([op, arg]) => op === 'select' && arg === 'actual_stripe_fee_cents',
      )
    ) {
      return options.refreshed;
    }
    return (
      options.order ?? {
        data: { actual_stripe_fee_cents: null, stripe_fee_reconciled_at: null },
      }
    );
  };

describe('payment_intent.succeeded single-modal settlement', () => {
  const settled = { data: { success: true, runtime_version: 'v2' } };

  it('settles once, then records the actual Stripe fee only where none is set', async () => {
    const result = await invoke(succeeded(), {
      rpc: { fn_create_shipments_from_single_payment: settled },
      table: orderTable({}),
      stripe: {
        'charges.retrieve': () => ({
          id: 'ch_1',
          balance_transaction: { fee: 4_321 },
        }),
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(result.effects).toEqual([
      'supabase',
      'rpc:fn_create_shipments_from_single_payment',
      'from:orders',
      'stripe:charges.retrieve',
      'from:orders',
    ]);
    expect(result.rpcs[0]).toEqual({
      name: 'fn_create_shipments_from_single_payment',
      args: SETTLEMENT_ARGS,
    });
    expect(result.stripeCalls[0]?.args).toEqual([
      'ch_1',
      { expand: ['balance_transaction'] },
    ]);
    expect(result.queries[0]?.ops).toEqual([
      ['select', 'actual_stripe_fee_cents, stripe_fee_reconciled_at'],
      ['eq', 'id', ORDER_ID],
      ['single'],
    ]);
    expect(result.queries[1]?.ops).toEqual([
      [
        'update',
        {
          actual_stripe_fee_cents: 4_321,
          stripe_fee_reconciled_at: expect.any(String),
          updated_at: expect.any(String),
        },
      ],
      ['eq', 'id', ORDER_ID],
      ['is', 'actual_stripe_fee_cents', null],
      ['select', 'id'],
    ]);
  });

  it('reads the charge id from the legacy charges list', async () => {
    const result = await invoke(
      succeeded({ latest_charge: null, charges: { data: [{ id: 'ch_1' }] } }),
      {
        rpc: { fn_create_shipments_from_single_payment: settled },
        table: orderTable({ order: { data: { actual_stripe_fee_cents: 9 } } }),
        stripe: {
          'charges.retrieve': () => ({
            id: 'ch_1',
            balance_transaction: { fee: 9 },
          }),
        },
      },
    );
    expect(result.status).toBe(200);
    expect(result.rpcs[0]?.args.p_stripe_charge_id).toBe('ch_1');
    // already_reconciled: no fee write.
    expect(result.queries.map((query) => query.table)).toEqual(['orders']);
  });

  it('queues one idempotent fee job when the balance transaction is not ready', async () => {
    const result = await invoke(succeeded(), {
      rpc: { fn_create_shipments_from_single_payment: settled },
      table: orderTable({}),
      stripe: {
        'charges.retrieve': () => ({ id: 'ch_1', balance_transaction: null }),
      },
    });
    expect(result.status).toBe(200);
    expect(result.queries[1]).toEqual({
      table: 'stripe_fee_reconciliation_jobs',
      ops: [
        [
          'upsert',
          {
            order_id: ORDER_ID,
            stripe_payment_intent_id: 'pi_single',
            status: 'pending',
            attempt_count: 0,
            next_retry_at: expect.any(String),
            last_error: null,
            updated_at: expect.any(String),
          },
          {
            onConflict: 'order_id,stripe_payment_intent_id',
            ignoreDuplicates: true,
          },
        ],
      ],
    });
    expect(result.queries).toHaveLength(2);
  });

  it('accepts a fee another writer already recorded', async () => {
    const result = await invoke(succeeded(), {
      rpc: { fn_create_shipments_from_single_payment: settled },
      table: orderTable({
        updated: { data: [] },
        refreshed: { data: { actual_stripe_fee_cents: 4_321 } },
      }),
      stripe: {
        'charges.retrieve': () => ({
          id: 'ch_1',
          balance_transaction: { fee: 4_321 },
        }),
      },
    });
    expect(result.status).toBe(200);
    expect(result.queries.map((query) => query.table)).toEqual([
      'orders',
      'orders',
      'orders',
    ]);
  });

  const failures: Array<[string, Options, string]> = [
    [
      'the order lookup fails',
      { table: orderTable({ order: { data: null } }) },
      'ORDER_STRIPE_FEE_LOOKUP_FAILED: not_found',
    ],
    [
      'the fee job cannot be queued',
      {
        table: orderTable({ job: { error: { message: 'jobs down' } } }),
        stripe: { 'charges.retrieve': () => ({ id: 'ch_1' }) },
      },
      'STRIPE_FEE_RECONCILIATION_JOB_UPSERT_FAILED: jobs down',
    ],
    [
      'the fee update fails',
      {
        table: orderTable({ updated: { error: { message: 'update down' } } }),
        stripe: {
          'charges.retrieve': () => ({
            id: 'ch_1',
            balance_transaction: { fee: 1 },
          }),
        },
      },
      'ORDER_STRIPE_FEE_UPDATE_FAILED: update down',
    ],
    [
      'no fee is recorded after a lost update',
      {
        table: orderTable({ updated: { data: [] }, refreshed: { data: {} } }),
        stripe: {
          'charges.retrieve': () => ({
            id: 'ch_1',
            balance_transaction: { fee: 1 },
          }),
        },
      },
      'ORDER_STRIPE_FEE_UPDATE_CONFLICT',
    ],
    [
      'the refresh fails',
      {
        table: orderTable({
          updated: { data: [] },
          refreshed: { error: { message: 'refresh down' } },
        }),
        stripe: {
          'charges.retrieve': () => ({
            id: 'ch_1',
            balance_transaction: { fee: 1 },
          }),
        },
      },
      'ORDER_STRIPE_FEE_REFRESH_FAILED: refresh down',
    ],
  ];
  for (const [label, options, message] of failures) {
    it(`sends the event to the DLQ when ${label}`, async () => {
      const event = succeeded();
      const result = await invoke(event, {
        ...options,
        rpc: { fn_create_shipments_from_single_payment: settled },
      });
      expectDlq(result, event, message);
    });
  }

  it('sends a paid intent without a charge id to the DLQ before settling', async () => {
    const event = succeeded({ latest_charge: null });
    const result = await invoke(event);
    expectDlq(result, event, 'MISSING_STRIPE_CHARGE_ID');
    expect(result.rpcs).toEqual([]);
    expect(result.stripeCalls).toEqual([]);
  });

  it('sends a failed settlement RPC to the DLQ without any Stripe call', async () => {
    const event = succeeded();
    const result = await invoke(event, {
      rpc: {
        fn_create_shipments_from_single_payment: {
          error: { message: 'connection reset' },
        },
      },
    });
    expectDlq(result, event, 'connection reset');
    expect(result.stripeCalls).toEqual([]);
    expect(logged('Single-modal settlement fatal_error')).toHaveLength(1);
  });

  it('acknowledges a transient recovered settlement without refunding', async () => {
    const result = await invoke(succeeded(), {
      rpc: {
        fn_create_shipments_from_single_payment: {
          data: {
            success: false,
            error: 'LOCK_TIMEOUT',
            runtime_version: 'v2',
          },
        },
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(result.effects).toEqual([
      'supabase',
      'rpc:fn_create_shipments_from_single_payment',
    ]);
    expect(logged('Single-modal settlement recovered for ops retry')).toEqual([
      expect.objectContaining({
        reason: 'LOCK_TIMEOUT',
        classification: 'transient',
        runtimeSettlementVersion: 'v2',
        recoveryRuntimeVersion: null,
      }),
    ]);
  });
});

describe('checkout recovery compensation (refund first)', () => {
  const semantic = {
    fn_create_shipments_from_single_payment: {
      data: { success: false, error: 'PRODUCT_NOT_RESERVED' },
    },
  };
  const claimed = {
    data: [{ stripe_payment_intent_id: 'pi_single' }],
  };
  const refunded = () => ({ id: 're_1', status: 'succeeded' });

  it('upserts the shell, claims it, refunds with the transfer reversed, then finalizes', async () => {
    const result = await invoke(succeeded(), {
      rpc: {
        ...semantic,
        fn_upsert_checkout_recovery_shell: { data: { runtime_version: 'r3' } },
        fn_claim_checkout_recovery_shells: claimed,
      },
      stripe: {
        'charges.retrieve': () => ({ id: 'ch_1', transfer: 'tr_1' }),
        'refunds.create': refunded,
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(result.effects).toEqual([
      'supabase',
      'rpc:fn_create_shipments_from_single_payment',
      'rpc:fn_upsert_checkout_recovery_shell',
      'stripe:charges.retrieve',
      'rpc:fn_claim_checkout_recovery_shells',
      'stripe:refunds.create',
      'rpc:fn_finalize_checkout_recovery',
    ]);
    expect(result.rpcs.slice(1)).toEqual([
      {
        name: 'fn_upsert_checkout_recovery_shell',
        args: {
          p_stripe_payment_intent_id: 'pi_single',
          p_reason: 'PRODUCT_NOT_RESERVED',
          p_source_metadata: singleModalMetadata(),
          p_charged_amount_cents: 103_900,
          p_stripe_charge_id: 'ch_1',
        },
      },
      {
        name: 'fn_claim_checkout_recovery_shells',
        args: { p_limit: 1, p_stripe_payment_intent_id: 'pi_single' },
      },
      {
        name: 'fn_finalize_checkout_recovery',
        args: {
          p_stripe_payment_intent_id: 'pi_single',
          p_stripe_refund_id: 're_1',
        },
      },
    ]);
    expect(result.stripeCalls.map((call) => call.args)).toEqual([
      ['ch_1'],
      [
        { payment_intent: 'pi_single', reverse_transfer: true },
        { idempotencyKey: 'pi_pi_single_recovery' },
      ],
    ]);
    expect(logged('Checkout recovery compensation result')).toEqual([
      expect.objectContaining({
        result: 'refunded',
        recoveryRuntimeVersion: 'r3',
      }),
    ]);
    expect(logged('Single-modal settlement recovered for ops retry')).toEqual([
      expect.objectContaining({
        classification: 'semantic',
        recoveryRuntimeVersion: 'r3',
      }),
    ]);
  });

  for (const shell of ['r3', { runtime_version: 3 }, null]) {
    it(`logs no runtime version for a shell result of ${JSON.stringify(shell)}`, async () => {
      const result = await invoke(succeeded(), {
        rpc: {
          ...semantic,
          fn_upsert_checkout_recovery_shell: { data: shell },
          fn_claim_checkout_recovery_shells: claimed,
        },
        stripe: {
          'charges.retrieve': () => ({ id: 'ch_1', transfer: null }),
          'refunds.create': refunded,
        },
      });
      expect(result.status).toBe(200);
      expect(result.stripeCalls[1]?.args[0]).toEqual({
        payment_intent: 'pi_single',
      });
      expect(logged('Checkout recovery compensation result')).toEqual([
        expect.objectContaining({ recoveryRuntimeVersion: null }),
      ]);
    });
  }

  it('does not refund a shell another worker holds', async () => {
    const result = await invoke(succeeded(), {
      rpc: { ...semantic, fn_claim_checkout_recovery_shells: { data: [] } },
      stripe: { 'charges.retrieve': () => ({ id: 'ch_1' }) },
    });
    expect(result.status).toBe(200);
    expect(result.stripeCalls.map((call) => call.method)).toEqual([
      'charges.retrieve',
    ]);
    expect(logged('Checkout recovery compensation result')).toEqual([
      expect.objectContaining({ result: 'busy' }),
    ]);
  });

  it('queues a retry when the refund is not confirmed', async () => {
    const result = await invoke(succeeded(), {
      rpc: { ...semantic, fn_claim_checkout_recovery_shells: claimed },
      stripe: {
        'charges.retrieve': () => ({ id: 'ch_1' }),
        'refunds.create': () => ({ id: 're_1', status: 'pending' }),
      },
    });
    expect(result.status).toBe(200);
    expect(result.rpcs.at(-1)).toEqual({
      name: 'fn_mark_checkout_recovery_retry',
      args: {
        p_stripe_payment_intent_id: 'pi_single',
        p_error: 'STRIPE_REFUND_NOT_CONFIRMED:pending',
      },
    });
    expect(result.rpcs.map((rpc) => rpc.name)).not.toContain(
      'fn_finalize_checkout_recovery',
    );
  });

  const failures: Array<[string, Options['rpc'], string]> = [
    [
      'the shell upsert fails',
      { fn_upsert_checkout_recovery_shell: { error: { message: 'x' } } },
      'CHECKOUT_RECOVERY_SHELL_FAILED: x',
    ],
    [
      'the claim fails',
      { fn_claim_checkout_recovery_shells: { error: { message: 'x' } } },
      'CHECKOUT_RECOVERY_CLAIM_FAILED: x',
    ],
    [
      'the retry cannot be queued',
      {
        fn_claim_checkout_recovery_shells: claimed,
        fn_finalize_checkout_recovery: { error: { message: 'f' } },
        fn_mark_checkout_recovery_retry: { error: { message: 'x' } },
      },
      'CHECKOUT_RECOVERY_RETRY_QUEUE_FAILED: x',
    ],
  ];
  for (const [label, rpc, message] of failures) {
    it(`sends the event to the DLQ when ${label}`, async () => {
      const event = succeeded();
      const result = await invoke(event, {
        rpc: { ...semantic, ...rpc },
        stripe: {
          'charges.retrieve': () => ({ id: 'ch_1' }),
          'refunds.create': refunded,
        },
      });
      expectDlq(result, event, message);
    });
  }

  it('compensates retired seller-grouped metadata without settling it', async () => {
    const metadata = { app_name: 'selene', seller_id: 'seller-1' };
    const result = await invoke(succeeded({ metadata }), {
      rpc: { fn_claim_checkout_recovery_shells: claimed },
      stripe: {
        'charges.retrieve': () => ({ id: 'ch_1' }),
        'refunds.create': refunded,
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      received: true,
      retired: 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED',
    });
    expect(result.rpcs.map((rpc) => rpc.name)).toEqual([
      'fn_upsert_checkout_recovery_shell',
      'fn_claim_checkout_recovery_shells',
      'fn_finalize_checkout_recovery',
    ]);
    expect(result.rpcs[0]?.args).toMatchObject({
      p_reason: 'LEGACY_GROUPED_SETTLEMENT_METADATA',
      p_source_metadata: metadata,
    });
  });

  it('compensates invalid single-modal metadata without settling it', async () => {
    const metadata = { ...singleModalMetadata(), buyer_total_cents: '1' };
    const result = await invoke(succeeded({ metadata }), {
      rpc: { fn_claim_checkout_recovery_shells: claimed },
      stripe: {
        'charges.retrieve': () => ({ id: 'ch_1' }),
        'refunds.create': refunded,
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(result.rpcs[0]?.args).toMatchObject({
      p_reason: 'INVALID_SINGLE_MODAL_METADATA:buyer_total_mismatch',
    });
    expect(result.rpcs.map((rpc) => rpc.name)).not.toContain(
      'fn_create_shipments_from_single_payment',
    );
  });

  for (const [label, intent] of [
    ['retired', { metadata: { seller_id: 'seller-1' } }],
    ['invalid', { metadata: { flow: SINGLE_MODAL_FLOW } }],
  ] as const) {
    it(`sends ${label} metadata without a charge id to the DLQ`, async () => {
      const event = succeeded({ ...intent, latest_charge: null });
      const result = await invoke(event);
      expectDlq(result, event, 'MISSING_STRIPE_CHARGE_ID');
      expect(result.rpcs).toEqual([]);
    });
  }

  it('acknowledges a succeeded intent from outside Selene with no effect', async () => {
    const result = await invoke(succeeded({ metadata: {} }));
    expect(result.status).toBe(200);
    expect(result.effects).toEqual(['supabase']);
  });
});

const RUN = {
  id: 'run-1',
  status: 'pending_reconciliation',
  stripe_payout_id: 'po_1',
  seller_id: 'seller-1',
  paid_at: null as string | null,
};
const payout = (type: string, object: Record<string, unknown> = {}) =>
  stripeEvent(
    type,
    { id: 'po_1', object: 'payout', status: 'paid', metadata: {}, ...object },
    { account: 'acct_1' },
  );
const runTable =
  (byPayoutId: unknown, byRunId: unknown = null, sellerAccount?: unknown) =>
  (query: Query): Result | undefined => {
    if (query.table === 'profiles_private') {
      return { data: sellerAccount === undefined ? null : sellerAccount };
    }
    if (query.table !== 'connect_payout_runs') return undefined;
    const [, column] =
      query.ops.find(([op]) => op === 'eq') ?? ([] as unknown[]);
    return { data: column === 'stripe_payout_id' ? byPayoutId : byRunId };
  };

describe('Connect payout events', () => {
  for (const type of [
    'payout.created',
    'payout.updated',
    'payout.paid',
    'payout.failed',
    'payout.canceled',
  ]) {
    it(`${type} looks up the run for the payout`, async () => {
      const result = await invoke(payout(type));
      expect(result.status).toBe(200);
      expect(result.queries).toEqual([
        {
          table: 'connect_payout_runs',
          ops: [
            ['select', 'id, status, stripe_payout_id, seller_id, paid_at'],
            ['eq', 'stripe_payout_id', 'po_1'],
            ['maybeSingle'],
          ],
        },
      ]);
      expect(result.rpcs).toEqual([]);
      expect(logged('Connect payout reconciliation processed')).toEqual([
        expect.objectContaining({ eventType: type, result: 'ignored' }),
      ]);
    });
  }

  it('records signed evidence and projects a paid payout through the atomic RPC only', async () => {
    const event = payout('payout.paid');
    const result = await invoke(event, {
      table: runTable(RUN),
      rpc: {
        fn_append_connect_payout_event: { data: true },
        fn_project_payout_run_terminal: { data: true },
      },
    });
    expect(result.status).toBe(200);
    expect(result.effects).toEqual([
      'supabase',
      'from:connect_payout_runs',
      'rpc:fn_append_connect_payout_event',
      'rpc:fn_project_payout_run_terminal',
    ]);
    expect(result.rpcs[0]?.args).toEqual({
      p_stripe_event_id: event.id,
      p_event_type: 'payout.paid',
      p_stripe_payout_id: 'po_1',
      p_connect_payout_run_id: 'run-1',
      p_stripe_created: new Date(1_782_000_000_000).toISOString(),
      p_observed_payout_status: 'paid',
      p_failure_code: null,
      p_failure_message: null,
      p_failure_balance_transaction: null,
    });
    expect(result.rpcs[1]?.args).toEqual({
      p_run_id: 'run-1',
      p_payout_id: 'po_1',
      p_target_status: 'paid',
      p_occurred_at: new Date(1_782_000_000_000).toISOString(),
      p_failure_reason: 'paid',
    });
    expect(logged('Connect payout reconciliation processed')).toEqual([
      expect.objectContaining({ result: 'reconciled', runId: 'run-1' }),
    ]);
  });

  it('passes the failure details and balance transaction of a failed payout', async () => {
    const result = await invoke(
      payout('payout.failed', {
        status: 'failed',
        failure_code: 'account_closed',
        failure_message: 'closed',
        failure_balance_transaction: { id: 'txn_1' },
      }),
      {
        table: runTable(RUN),
        rpc: {
          fn_append_connect_payout_event: { data: true },
          fn_project_payout_run_terminal: { data: true },
        },
      },
    );
    expect(result.status).toBe(200);
    expect(result.rpcs[0]?.args).toMatchObject({
      p_failure_code: 'account_closed',
      p_failure_message: 'closed',
      p_failure_balance_transaction: 'txn_1',
    });
    expect(result.rpcs[1]?.args.p_failure_reason).toBe(
      'closed | failure_balance_transaction: txn_1',
    );
  });

  it('does not project a duplicate event again', async () => {
    const result = await invoke(payout('payout.paid'), {
      table: runTable(RUN),
      rpc: { fn_append_connect_payout_event: { data: false } },
    });
    expect(result.status).toBe(200);
    expect(result.rpcs.map((rpc) => rpc.name)).toEqual([
      'fn_append_connect_payout_event',
    ]);
    expect(logged('Connect payout reconciliation processed')).toEqual([
      expect.objectContaining({ result: 'duplicate_event' }),
    ]);
  });

  it('falls back to the metadata run id only for a recoverable run without a payout id', async () => {
    const result = await invoke(
      payout('payout.paid', { metadata: { run_id: 'run-1' } }),
      {
        table: runTable(null, {
          ...RUN,
          status: 'paid',
          stripe_payout_id: null,
        }),
      },
    );
    expect(result.status).toBe(200);
    expect(result.queries.map((query) => query.ops[1])).toEqual([
      ['eq', 'stripe_payout_id', 'po_1'],
      ['eq', 'id', 'run-1'],
    ]);
    expect(result.rpcs).toEqual([]);
  });

  it('projects payout.created to payout_pending', async () => {
    const result = await invoke(
      payout('payout.created', { status: 'pending' }),
      {
        table: runTable(RUN),
        rpc: {
          fn_append_connect_payout_event: { data: true },
          fn_project_payout_run_stage: { data: true },
        },
      },
    );
    expect(result.status).toBe(200);
    expect(result.rpcs[1]).toEqual({
      name: 'fn_project_payout_run_stage',
      args: {
        p_run_id: 'run-1',
        p_payout_id: 'po_1',
        p_target_stage: 'payout_pending',
      },
    });
  });

  it('routes a refused stage projection through the park decision and logs only its category', async () => {
    const event = payout('payout.updated', { status: 'in_transit' });
    const result = await invoke(event, {
      table: runTable(RUN),
      rpc: {
        fn_append_connect_payout_event: { data: true },
        fn_project_payout_run_stage: { data: false },
        fn_decide_rejected_payout_stage_park: { data: 'parked' },
      },
    });
    expect(result.status).toBe(200);
    expect(result.rpcs.slice(1)).toEqual([
      {
        name: 'fn_project_payout_run_stage',
        args: {
          p_run_id: 'run-1',
          p_payout_id: 'po_1',
          p_target_stage: 'payout_in_transit',
        },
      },
      {
        name: 'fn_decide_rejected_payout_stage_park',
        args: {
          p_run_id: 'run-1',
          p_payout_id: 'po_1',
          p_target_stage: 'payout_in_transit',
          p_failure_reason: 'PAYOUT_STAGE_PROJECTION_CONFLICT',
        },
      },
    ]);
    expect(logged('Payout stage conflict decision')).toEqual([
      expect.objectContaining({ eventId: event.id, category: 'parked' }),
    ]);
    expect(logged('Connect payout reconciliation processed')).toEqual([
      expect.objectContaining({ result: 'reconciliation_needed' }),
    ]);
  });

  it('sends an invalid park decision to the DLQ', async () => {
    const event = payout('payout.created', { status: 'pending' });
    const result = await invoke(event, {
      table: runTable(RUN),
      rpc: {
        fn_append_connect_payout_event: { data: true },
        fn_project_payout_run_stage: { data: false },
        fn_decide_rejected_payout_stage_park: { data: 'maybe' },
      },
    });
    expectDlq(result, event, 'PAYOUT_STAGE_PARK_INVALID_DECISION');
  });

  it('parks the run through the guarded RPC when the stage write fails', async () => {
    const result = await invoke(
      payout('payout.created', { status: 'pending' }),
      {
        table: runTable(RUN),
        rpc: {
          fn_append_connect_payout_event: { data: true },
          fn_project_payout_run_stage: { error: { message: 'down' } },
          fn_mark_payout_run_reconciliation_needed: { data: false },
        },
      },
    );
    expect(result.status).toBe(200);
    expect(result.rpcs.at(-1)).toEqual({
      name: 'fn_mark_payout_run_reconciliation_needed',
      args: {
        p_run_id: 'run-1',
        p_failure_reason: 'PAYOUT_STAGE_UPDATE_FAILED: down',
      },
    });
    expect(
      logged('Connect payout reconciliation park was a no-op'),
    ).toHaveLength(1);
    // No direct run, mapping or shipment write.
    expect(result.queries.map((query) => query.table)).toEqual([
      'connect_payout_runs',
    ]);
  });

  it('asks Stripe for the payout on the seller account before a late failure downgrades a paid run', async () => {
    const result = await invoke(payout('payout.failed', { status: 'failed' }), {
      table: runTable(
        { ...RUN, status: 'paid', paid_at: '2099-01-01T00:00:00.000Z' },
        null,
        { stripe_account_id: 'acct_seller' },
      ),
      rpc: { fn_append_connect_payout_event: { data: true } },
      stripe: {
        'payouts.retrieve': () => ({ id: 'po_1', status: 'paid' }),
      },
    });
    expect(result.status).toBe(200);
    expect(result.queries[1]).toEqual({
      table: 'profiles_private',
      ops: [
        ['select', 'stripe_account_id'],
        ['eq', 'id', 'seller-1'],
        ['maybeSingle'],
      ],
    });
    expect(result.stripeCalls).toEqual([
      {
        method: 'payouts.retrieve',
        args: ['po_1', {}, { stripeAccount: 'acct_seller' }],
      },
    ]);
    expect(result.rpcs.map((rpc) => rpc.name)).toEqual([
      'fn_append_connect_payout_event',
    ]);
    expect(logged('Connect payout reconciliation processed')).toEqual([
      expect.objectContaining({ result: 'already_reconciled' }),
    ]);
  });

  it('parks a paid run when the seller has no Connect account', async () => {
    const result = await invoke(payout('payout.failed', { status: 'failed' }), {
      table: runTable({
        ...RUN,
        status: 'paid',
        paid_at: '2099-01-01T00:00:00.000Z',
      }),
      rpc: {
        fn_append_connect_payout_event: { data: true },
        fn_mark_payout_run_reconciliation_needed: { data: true },
      },
    });
    expect(result.status).toBe(200);
    expect(result.stripeCalls).toEqual([]);
    expect(result.rpcs.at(-1)?.args).toEqual({
      p_run_id: 'run-1',
      p_failure_reason: 'CONNECT_ACCOUNT_LOOKUP_MISSING',
    });
  });

  it('sends a payout with an unknown status to the DLQ before any lookup', async () => {
    const event = payout('payout.updated', { status: 'weird' });
    const result = await invoke(event);
    expectDlq(result, event, 'UNEXPECTED_PAYOUT_STATUS:weird');
    expect(result.queries.map((query) => query.table)).toEqual(['webhook_dlq']);
  });
});

const BANK = {
  id: 'ba_current',
  object: 'bank_account',
  account: 'acct_1',
  currency: 'mxn',
  default_for_currency: true,
  status: 'verified',
};
const accountStripe = (
  overrides: Record<string, (...args: unknown[]) => unknown> = {},
) => ({
  'accounts.retrieve': () => ({ id: 'acct_1', payouts_enabled: true }),
  'accounts.listExternalAccounts': () => ({ data: [BANK], has_more: false }),
  ...overrides,
});
const accountRpc = (overrides: Options['rpc'] = {}): Options['rpc'] => ({
  fn_record_connect_account_event: { data: true },
  fn_acquire_connect_account_refresh: { data: '42' },
  fn_commit_connect_account_refresh: { data: true },
  ...overrides,
});
const bankEvent = (type: string, account: unknown = 'acct_1') =>
  stripeEvent(
    type,
    { id: 'ba_old', object: 'bank_account', account, status: 'errored' },
    { account: 'acct_1' },
  );
const COMMIT_ARGS = {
  p_stripe_account_id: 'acct_1',
  p_expected_generation: 42,
  p_is_actionable: true,
  p_blocked_reason: null,
  p_payouts_enabled: true,
  p_current_external_account_id: 'ba_current',
  p_current_external_account_status: 'verified',
  p_current_currency: 'mxn',
  p_current_default_for_currency: true,
  p_mxn_default_count: 1,
};

describe('Connect account events', () => {
  for (const kind of ['created', 'updated', 'deleted']) {
    it(`account.external_account.${kind} records signed evidence and commits a fresh Stripe snapshot`, async () => {
      const event = bankEvent(`account.external_account.${kind}`);
      const result = await invoke(event, {
        rpc: accountRpc(),
        stripe: accountStripe(),
      });
      expect(result.status).toBe(200);
      expect(result.effects).toEqual([
        'supabase',
        'rpc:fn_record_connect_account_event',
        'rpc:fn_acquire_connect_account_refresh',
        'stripe:accounts.retrieve',
        'stripe:accounts.listExternalAccounts',
        'rpc:fn_commit_connect_account_refresh',
      ]);
      expect(result.rpcs).toEqual([
        {
          name: 'fn_record_connect_account_event',
          args: {
            p_stripe_event_id: event.id,
            p_stripe_account_id: 'acct_1',
            p_event_type: `account.external_account.${kind}`,
            p_stripe_created: new Date(1_782_000_000_000).toISOString(),
            p_external_account_id: 'ba_old',
            p_payouts_enabled: null,
            p_external_account_status: 'errored',
          },
        },
        {
          name: 'fn_acquire_connect_account_refresh',
          args: { p_stripe_account_id: 'acct_1', p_source_event_id: event.id },
        },
        {
          name: 'fn_commit_connect_account_refresh',
          args: { ...COMMIT_ARGS, p_source_event_id: event.id },
        },
      ]);
      expect(result.stripeCalls.map((call) => call.args)).toEqual([
        ['acct_1'],
        ['acct_1', { object: 'bank_account', limit: 100 }],
      ]);
      expect(logged('Connect account refresh committed')).toEqual([
        expect.objectContaining({
          accountId: 'acct_1',
          generation: 42,
          actionable: true,
          blockedReason: null,
        }),
      ]);
    });
  }

  it('account.updated stores the onboarding status before refreshing', async () => {
    const event = stripeEvent('account.updated', {
      id: 'acct_1',
      object: 'account',
      charges_enabled: true,
      payouts_enabled: true,
    });
    const result = await invoke(event, {
      rpc: accountRpc(),
      stripe: accountStripe(),
    });
    expect(result.status).toBe(200);
    expect(result.effects.slice(0, 3)).toEqual([
      'supabase',
      'from:profiles_private',
      'rpc:fn_record_connect_account_event',
    ]);
    expect(result.queries[0]?.ops).toEqual([
      [
        'update',
        {
          stripe_onboarding_status: 'complete',
          stripe_onboarding_refreshed_at: expect.any(String),
          updated_at: expect.any(String),
        },
      ],
      ['eq', 'stripe_account_id', 'acct_1'],
    ]);
    expect(result.rpcs[0]?.args).toMatchObject({
      p_event_type: 'account.updated',
      p_payouts_enabled: true,
    });
  });

  it('sends a failed onboarding update to the DLQ before any evidence write', async () => {
    const event = stripeEvent('account.updated', {
      id: 'acct_1',
      object: 'account',
    });
    const result = await invoke(event, {
      table: (query) =>
        query.table === 'profiles_private'
          ? { error: { message: 'denied' } }
          : undefined,
    });
    expectDlq(result, event, 'PROFILE_UPDATE_FAILED: denied');
    expect(result.rpcs).toEqual([]);
  });

  it('refuses an event whose object and envelope accounts disagree', async () => {
    const event = bankEvent('account.external_account.updated', 'acct_other');
    const result = await invoke(event);
    expectDlq(result, event, 'ACCOUNT_EVENT_IDENTITY_INVALID');
    expect(result.rpcs).toEqual([]);
    expect(result.stripeCalls).toEqual([]);
  });

  it('still refreshes after a duplicate evidence append', async () => {
    const result = await invoke(bankEvent('account.external_account.updated'), {
      rpc: accountRpc({ fn_record_connect_account_event: { data: false } }),
      stripe: accountStripe(),
    });
    expect(result.status).toBe(200);
    expect(result.rpcs.map((rpc) => rpc.name)).toContain(
      'fn_commit_connect_account_refresh',
    );
  });

  it('pages the bank accounts from the last id', async () => {
    const pages = [
      {
        data: [{ ...BANK, id: 'ba_a', default_for_currency: false }],
        has_more: true,
      },
      { data: [BANK], has_more: false },
    ];
    const result = await invoke(bankEvent('account.external_account.updated'), {
      rpc: accountRpc(),
      stripe: accountStripe({
        'accounts.listExternalAccounts': () => pages.shift(),
      }),
    });
    expect(result.status).toBe(200);
    expect(result.stripeCalls.slice(1).map((call) => call.args)).toEqual([
      ['acct_1', { object: 'bank_account', limit: 100 }],
      [
        'acct_1',
        { object: 'bank_account', limit: 100, starting_after: 'ba_a' },
      ],
    ]);
  });

  const failures: Array<[string, Options, string]> = [
    [
      'the evidence append fails',
      {
        rpc: accountRpc({
          fn_record_connect_account_event: {
            error: { message: 'provider detail' },
          },
        }),
      },
      'ACCOUNT_EVENT_APPEND_FAILED',
    ],
    [
      'the evidence append returns a non-boolean',
      {
        rpc: accountRpc({ fn_record_connect_account_event: { data: 'true' } }),
      },
      'ACCOUNT_EVENT_APPEND_INVALID_RESULT',
    ],
    [
      'the refresh cannot be acquired',
      {
        rpc: accountRpc({
          fn_acquire_connect_account_refresh: {
            error: { message: 'provider detail' },
          },
        }),
      },
      'ACCOUNT_REFRESH_ACQUIRE_FAILED',
    ],
    [
      'the generation is not a positive integer',
      {
        rpc: accountRpc({ fn_acquire_connect_account_refresh: { data: 'x' } }),
      },
      'ACCOUNT_REFRESH_INVALID_GENERATION',
    ],
    [
      'Stripe cannot return the account',
      {
        rpc: accountRpc(),
        stripe: accountStripe({
          'accounts.retrieve': () => Promise.reject(new Error('sdk detail')),
        }),
      },
      'ACCOUNT_REFRESH_RETRIEVAL_FAILED',
    ],
    [
      'Stripe cannot list the bank accounts',
      {
        rpc: accountRpc(),
        stripe: accountStripe({
          'accounts.listExternalAccounts': () =>
            Promise.reject(new Error('sdk detail')),
        }),
      },
      'ACCOUNT_REFRESH_BANK_LIST_FAILED',
    ],
    [
      'the commit fails',
      {
        rpc: accountRpc({
          fn_commit_connect_account_refresh: {
            error: { message: 'provider detail' },
          },
        }),
        stripe: accountStripe(),
      },
      'ACCOUNT_REFRESH_COMMIT_FAILED',
    ],
    [
      'the commit returns a non-boolean',
      {
        rpc: accountRpc({
          fn_commit_connect_account_refresh: { data: 'true' },
        }),
        stripe: accountStripe(),
      },
      'ACCOUNT_REFRESH_COMMIT_INVALID_RESULT',
    ],
    [
      'a newer refresh superseded this one',
      {
        rpc: accountRpc({ fn_commit_connect_account_refresh: { data: false } }),
        stripe: accountStripe(),
      },
      'ACCOUNT_REFRESH_SUPERSEDED',
    ],
  ];
  for (const [label, options, category] of failures) {
    it(`sends the event to the DLQ with ${category} when ${label}`, async () => {
      const event = bankEvent('account.external_account.updated');
      const result = await invoke(event, options);
      expectDlq(result, event, category);
      expect(logged('Connect account refresh refused')).toEqual([
        expect.objectContaining({ accountId: 'acct_1', category }),
      ]);
      expect(logged('Connect account refresh committed')).toEqual([]);
    });
  }
});

describe('setup_intent.succeeded', () => {
  const setup = (metadata: Record<string, string>) =>
    stripeEvent('setup_intent.succeeded', {
      id: 'seti_1',
      payment_method: 'pm_1',
      metadata,
    });
  const selene = { app_name: 'selene', user_id: 'user-1' };

  it('saves the card of a Selene user', async () => {
    const result = await invoke(setup(selene), {
      stripe: {
        'paymentMethods.retrieve': () => ({
          id: 'pm_1',
          type: 'card',
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
        }),
      },
    });
    expect(result.status).toBe(200);
    expect(result.stripeCalls).toEqual([
      { method: 'paymentMethods.retrieve', args: ['pm_1'] },
    ]);
    expect(result.queries).toEqual([
      {
        table: 'payment_methods',
        ops: [
          [
            'insert',
            {
              user_id: 'user-1',
              stripe_payment_method_id: 'pm_1',
              brand: 'visa',
              last4: '4242',
              exp_month: 12,
              exp_year: 2030,
            },
          ],
        ],
      },
    ]);
  });

  it('saves nothing for a payment method that is not a card', async () => {
    const result = await invoke(setup(selene), {
      stripe: {
        'paymentMethods.retrieve': () => ({ id: 'pm_1', type: 'oxxo' }),
      },
    });
    expect(result.status).toBe(200);
    expect(result.queries).toEqual([]);
    expect(
      logged('SetupIntent payment method is not a card; not saved'),
    ).toHaveLength(1);
  });

  it('ignores a setup intent from another app', async () => {
    const result = await invoke(
      setup({ app_name: 'other', user_id: 'user-1' }),
    );
    expect(result.status).toBe(200);
    expect(result.effects).toEqual(['supabase']);
  });
});

describe('shipment refund events', () => {
  const SHIPMENT_ID = 'dddddddd-0000-4000-8000-000000000011';
  const refund = (type: string, overrides: Record<string, unknown> = {}) =>
    stripeEvent(type, {
      id: 're_1',
      object: 'refund',
      payment_intent: 'pi_1',
      amount: 12_000,
      status: 'succeeded',
      metadata: { shipment_id: SHIPMENT_ID },
      ...overrides,
    });

  for (const type of ['refund.updated', 'refund.failed']) {
    it(`${type} applies the refund through the service RPC`, async () => {
      const event = refund(type, {
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      });
      const result = await invoke(event, {
        rpc: {
          fn_apply_shipment_cancellation_refund_event: {
            data: { outcome: 'recorded' },
          },
        },
      });
      expect(result.status).toBe(200);
      expect(result.rpcs).toEqual([
        {
          name: 'fn_apply_shipment_cancellation_refund_event',
          args: {
            p_shipment_id: SHIPMENT_ID,
            p_refund_id: 're_1',
            p_payment_intent_id: 'pi_1',
            p_amount_cents: 12_000,
            p_status: 'failed',
            p_failure_reason: 'expired_or_canceled_card',
          },
        },
      ]);
      expect(logged('Shipment refund event processed')).toEqual([
        expect.objectContaining({
          eventId: event.id,
          eventType: type,
          outcome: 'recorded',
        }),
      ]);
    });
  }

  it('alerts with a CRITICAL log for a refund that failed after cancellation', async () => {
    const result = await invoke(refund('refund.failed', { status: 'failed' }), {
      rpc: {
        fn_apply_shipment_cancellation_refund_event: {
          data: {
            outcome: 'failed_after_cancellation',
            amount_owed_cents: 12_000,
          },
        },
      },
    });
    expect(result.status).toBe(200);
    expect(logged('SHIPMENT_REFUND_FAILED_AFTER_CANCELLATION')).toEqual([
      expect.objectContaining({
        level: 'CRITICAL',
        shipmentId: SHIPMENT_ID,
        amountOwedCents: 12_000,
      }),
    ]);
  });

  it('ignores a refund that is not for a shipment', async () => {
    const result = await invoke(refund('refund.updated', { metadata: {} }));
    expect(result.status).toBe(200);
    expect(result.rpcs).toEqual([]);
    expect(logged('Shipment refund event processed')).toEqual([
      expect.objectContaining({ ignored: 'not_a_shipment_refund' }),
    ]);
  });

  it('sends a failed refund RPC to the DLQ', async () => {
    const event = refund('refund.updated');
    const result = await invoke(event, {
      rpc: {
        fn_apply_shipment_cancellation_refund_event: {
          error: { message: 'db down' },
        },
      },
    });
    expectDlq(result, event, 'REFUND_EVENT_RPC_FAILED');
  });
});

describe('dead-letter queue', () => {
  it('acknowledges an event type it does not handle with no effect', async () => {
    const result = await invoke(stripeEvent('charge.captured', { id: 'ch_1' }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(result.effects).toEqual(['supabase']);
  });

  it('still answers 500 when the DLQ write throws', async () => {
    const event = succeeded({ latest_charge: null });
    const result = await invoke(event, {
      table: (query) => {
        if (query.table === 'webhook_dlq') throw new Error('dlq down');
        return undefined;
      },
    });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'MISSING_STRIPE_CHARGE_ID' });
    expect(
      logged('Fallo catastrófico: No se pudo guardar en DLQ'),
    ).toHaveLength(1);
    expect(logged('Evento fallido guardado en DLQ exitosamente')).toEqual([]);
  });
});
