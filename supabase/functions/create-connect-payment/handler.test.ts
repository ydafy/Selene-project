import { describe, expect, it } from 'bun:test';

import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';
import {
  ADDRESS_ID,
  BUYER_ID,
  CUSTOMER_ID,
  DEFAULT_SNAPSHOT,
  PRODUCT_1,
  PRODUCT_2,
  PRODUCTS_SELECT,
  SELLER_A,
  SELLER_B,
  STRIPE_SECRET,
  SUPABASE_SECRET,
  SUPABASE_URL,
  allocationRowsFromMetadata,
  expectedPaymentIntentParams,
  moneyEffects,
  productRow,
  readySeller,
  runCreateConnectPayment,
} from './handler-fakes.ts';

const NO_MONEY_EFFECTS = {
  customers: 0,
  ephemeralKeys: 0,
  paymentIntents: 0,
  writes: 0,
};

const RESERVE_RPC = {
  name: 'fn_reserve_products',
  args: { p_product_ids: [PRODUCT_1], p_buyer_id: BUYER_ID },
};
const RELEASE_RPC = {
  name: 'fn_release_products',
  args: { p_product_ids: [PRODUCT_1] },
};

describe('create-connect-payment handler: configuration and auth', () => {
  for (const [label, options] of [
    ['STRIPE_SECRET_KEY', { env: { STRIPE_SECRET_KEY: undefined } }],
    ['SUPABASE_URL', { env: { SUPABASE_URL: undefined } }],
    ['the Supabase secret key', { supabaseSecretKey: undefined }],
  ] as const) {
    it(`answers 500 MISSING_SERVER_CONFIG without ${label} and creates no client`, async () => {
      const result = await runCreateConnectPayment(options);

      expect(result.status).toBe(500);
      expect(result.contentType).toBe('application/json');
      expect(result.body).toEqual({ error: 'MISSING_SERVER_CONFIG' });
      expect(result.calls).toEqual([]);
    });
  }

  it('creates the clients from the configured secrets', async () => {
    const result = await runCreateConnectPayment();

    expect(result.status).toBe(200);
    expect(result.stripeClients).toEqual([STRIPE_SECRET]);
    expect(result.supabaseClients).toEqual([[SUPABASE_URL, SUPABASE_SECRET]]);
  });

  it('answers 401 AUTH_REQUIRED without an Authorization header, before any call', async () => {
    const result = await runCreateConnectPayment({ authorization: null });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'AUTH_REQUIRED' });
    expect(result.calls).toEqual(['createStripe', 'createSupabaseAdmin']);
  });

  it('answers 401 when auth.getUser returns no user', async () => {
    const result = await runCreateConnectPayment({ user: null });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'AUTH_REQUIRED' });
    expect(result.calls).toEqual([
      'createStripe',
      'createSupabaseAdmin',
      'auth.getUser',
    ]);
  });

  it('answers 401 when auth.getUser returns an error, even with a user', async () => {
    const result = await runCreateConnectPayment({ authError: 'bad jwt' });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'AUTH_REQUIRED' });
    expect(result.calls).toEqual([
      'createStripe',
      'createSupabaseAdmin',
      'auth.getUser',
    ]);
  });

  it('verifies the bearer token without its prefix', async () => {
    const result = await runCreateConnectPayment();

    expect(result.tokens).toEqual(['user-token']);
  });

  it('answers 400 for an invalid body after auth, with no RPC or Stripe call', async () => {
    const result = await runCreateConnectPayment({
      body: { productIds: [PRODUCT_1], addressId: 'not-a-uuid' },
    });

    expect(result.status).toBe(400);
    expect(String(result.body.error)).toContain('addressId');
    expect(result.calls).toEqual([
      'createStripe',
      'createSupabaseAdmin',
      'auth.getUser',
    ]);
  });

  it('answers 400 when neither items nor productIds is sent', async () => {
    const result = await runCreateConnectPayment({
      body: { addressId: ADDRESS_ID },
    });

    expect(result.status).toBe(400);
    expect(String(result.body.error)).toContain(
      'items or productIds is required',
    );
    expect(result.rpcs).toEqual([]);
    expect(moneyEffects(result)).toEqual(NO_MONEY_EFFECTS);
  });
});

describe('create-connect-payment handler: successful checkout', () => {
  it('reserves, loads, and creates one PaymentIntent for an existing customer', async () => {
    const result = await runCreateConnectPayment();
    const expected = expectedPaymentIntentParams({
      orderId: 'uuid-1',
      customerId: CUSTOMER_ID,
      products: [
        {
          productId: PRODUCT_1,
          sellerId: SELLER_A,
          shipmentId: 'uuid-2',
          subtotalCents: 123_450,
          snapshot: DEFAULT_SNAPSHOT,
        },
      ],
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('application/json');
    expect(result.body).toEqual({
      orderId: 'uuid-1',
      clientSecret: 'pi_1_secret',
      customer: CUSTOMER_ID,
      ephemeralKey: 'ek_secret',
      amount: expected.amount,
      transferGroup: 'selene_order_uuid-1',
    });
    expect(result.calls).toEqual([
      'createStripe',
      'createSupabaseAdmin',
      'auth.getUser',
      'rpc:fn_reserve_products',
      'from:products',
      'from:system_settings',
      'from:profiles_private',
      'from:profiles_private',
      'stripe.ephemeralKeys.create',
      'stripe.paymentIntents.create',
    ]);
    expect(result.rpcs).toEqual([RESERVE_RPC]);
    expect(result.queries).toEqual([
      {
        table: 'products',
        ops: [
          ['select', PRODUCTS_SELECT],
          ['in', 'id', [PRODUCT_1]],
        ],
      },
      {
        table: 'system_settings',
        ops: [
          ['select', 'shipping_buffer_cents, insurance_rate, service_fee_pct'],
          ['eq', 'id', 1],
          ['maybeSingle'],
        ],
      },
      {
        table: 'profiles_private',
        ops: [
          ['select', 'id, stripe_account_id, stripe_onboarding_status'],
          ['in', 'id', [SELLER_A]],
        ],
      },
      {
        table: 'profiles_private',
        ops: [
          ['select', 'stripe_customer_id, email'],
          ['eq', 'id', BUYER_ID],
          ['single'],
        ],
      },
    ]);
    expect(result.customersCreate).toEqual([]);
    expect(result.ephemeralKeysCreate).toEqual([
      [{ customer: CUSTOMER_ID }, { apiVersion: STRIPE_API_VERSION }],
    ]);
    expect(result.paymentIntentsCreate).toEqual([[expected, {}]]);
    expect(expected).not.toHaveProperty('transfer_data');
    expect(expected).not.toHaveProperty('application_fee_amount');
  });

  it('creates and stores a Stripe customer when the buyer has none', async () => {
    const result = await runCreateConnectPayment({
      buyerProfile: { stripe_customer_id: null, email: 'profile@example.test' },
    });

    expect(result.status).toBe(200);
    expect(result.body.customer).toBe('cus_new');
    expect(result.customersCreate).toEqual([
      [
        {
          email: 'profile@example.test',
          metadata: { supabase_user_id: BUYER_ID, app_name: 'selene' },
        },
      ],
    ]);
    expect(result.queries.at(-1)).toEqual({
      table: 'profiles_private',
      ops: [
        ['update', { stripe_customer_id: 'cus_new' }],
        ['eq', 'id', BUYER_ID],
      ],
    });
    expect(result.calls.slice(-4)).toEqual([
      'stripe.customers.create',
      'from:profiles_private',
      'stripe.ephemeralKeys.create',
      'stripe.paymentIntents.create',
    ]);
    expect(result.ephemeralKeysCreate[0][0]).toEqual({ customer: 'cus_new' });
    expect(
      (result.paymentIntentsCreate[0][0] as { customer: string }).customer,
    ).toBe('cus_new');
  });

  it('falls back to the auth email when the buyer has no profile row', async () => {
    const result = await runCreateConnectPayment({ buyerProfile: null });

    expect(result.status).toBe(200);
    expect(result.customersCreate).toEqual([
      [
        {
          email: 'auth@example.test',
          metadata: { supabase_user_id: BUYER_ID, app_name: 'selene' },
        },
      ],
    ]);
  });

  it('gives each listing of a multi-seller order its own shipment', async () => {
    const second = productRow({
      id: PRODUCT_2,
      seller_id: SELLER_B,
      price_cents: 50_000,
    });
    const result = await runCreateConnectPayment({
      body: { productIds: [PRODUCT_1, PRODUCT_2], addressId: ADDRESS_ID },
      products: [productRow(), second],
    });
    const expected = expectedPaymentIntentParams({
      orderId: 'uuid-1',
      customerId: CUSTOMER_ID,
      products: [
        {
          productId: PRODUCT_1,
          sellerId: SELLER_A,
          shipmentId: 'uuid-2',
          subtotalCents: 123_450,
          snapshot: DEFAULT_SNAPSHOT,
        },
        {
          productId: PRODUCT_2,
          sellerId: SELLER_B,
          shipmentId: 'uuid-3',
          subtotalCents: 50_000,
          snapshot: DEFAULT_SNAPSHOT,
        },
      ],
    });

    expect(result.status).toBe(200);
    expect(result.rpcs).toEqual([
      {
        name: 'fn_reserve_products',
        args: { p_product_ids: [PRODUCT_1, PRODUCT_2], p_buyer_id: BUYER_ID },
      },
    ]);
    expect(result.queries[2].ops).toEqual([
      ['select', 'id, stripe_account_id, stripe_onboarding_status'],
      ['in', 'id', [SELLER_A, SELLER_B]],
    ]);
    expect(result.paymentIntentsCreate).toEqual([[expected, {}]]);
    expect(
      allocationRowsFromMetadata(expected.metadata).map((row) => [
        row.shipmentId,
        row.productIds,
      ]),
    ).toEqual([
      ['uuid-2', [PRODUCT_1]],
      ['uuid-3', [PRODUCT_2]],
    ]);
  });

  it('still charges when system settings cannot be read', async () => {
    const result = await runCreateConnectPayment({ settingsError: 'boom' });

    expect(result.status).toBe(200);
    expect(result.paymentIntentsCreate).toHaveLength(1);
  });
});

describe('create-connect-payment handler: legacy publication economics', () => {
  const legacy = productRow({
    publication_shipping_reserve_cents: null,
    publication_commission_rate: null,
    publication_insurance_rate: null,
  });

  it('backfills an all-null snapshot and prices the shipment from the backfill', async () => {
    const result = await runCreateConnectPayment({ products: [legacy] });
    const expected = expectedPaymentIntentParams({
      orderId: 'uuid-1',
      customerId: CUSTOMER_ID,
      products: [
        {
          productId: PRODUCT_1,
          sellerId: SELLER_A,
          shipmentId: 'uuid-2',
          subtotalCents: 123_450,
          snapshot: {
            publication_shipping_reserve_cents: 9_000,
            publication_commission_rate: 0.06,
            publication_insurance_rate: 0.012,
          },
        },
      ],
    });

    expect(result.status).toBe(200);
    expect(result.rpcs).toEqual([
      RESERVE_RPC,
      {
        name: 'backfill_product_publication_economics',
        args: { p_product_id: PRODUCT_1 },
      },
    ]);
    expect(result.paymentIntentsCreate).toEqual([[expected, {}]]);
  });

  for (const [label, backfill] of [
    ['an error', { data: null, error: { message: 'boom' } }],
    ['no row', { data: [], error: null }],
  ] as const) {
    it(`releases the reservation when the backfill returns ${label}`, async () => {
      const result = await runCreateConnectPayment({
        products: [legacy],
        backfill,
      });

      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        error: 'LEGACY_PUBLICATION_ECONOMICS_UNAVAILABLE',
      });
      expect(result.rpcs).toEqual([
        RESERVE_RPC,
        {
          name: 'backfill_product_publication_economics',
          args: { p_product_id: PRODUCT_1 },
        },
        RELEASE_RPC,
      ]);
      expect(moneyEffects(result)).toEqual(NO_MONEY_EFFECTS);
    });
  }
});

describe('create-connect-payment handler: failures before the charge', () => {
  for (const [label, reserve] of [
    ['a Postgrest error', { data: null, error: { message: 'boom' } }],
    ['success false', { data: [{ success: false }], error: null }],
    ['no data', { data: null, error: null }],
  ] as const) {
    it(`answers 409 RESERVATION_FAILED on ${label} and touches nothing else`, async () => {
      const result = await runCreateConnectPayment({ reserve });

      expect(result.status).toBe(409);
      expect(result.body).toEqual({ error: 'RESERVATION_FAILED' });
      expect(result.rpcs).toEqual([RESERVE_RPC]);
      expect(result.queries).toEqual([]);
      expect(moneyEffects(result)).toEqual(NO_MONEY_EFFECTS);
    });
  }

  for (const [label, options] of [
    ['an error', { productsError: 'boom' }],
    ['no rows', { products: [] }],
  ] as const) {
    it(`answers 404 PRODUCTS_NOT_FOUND on ${label} and releases the reservation`, async () => {
      const result = await runCreateConnectPayment(options);

      expect(result.status).toBe(404);
      expect(result.body).toEqual({ error: 'PRODUCTS_NOT_FOUND' });
      expect(result.rpcs).toEqual([RESERVE_RPC, RELEASE_RPC]);
      expect(result.calls.at(-1)).toBe('rpc:fn_release_products');
      expect(moneyEffects(result)).toEqual(NO_MONEY_EFFECTS);
    });
  }

  it('answers 500 PROFILES_LOAD_FAILED and releases the reservation', async () => {
    const result = await runCreateConnectPayment({ profilesError: 'boom' });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'PROFILES_LOAD_FAILED' });
    expect(result.rpcs).toEqual([RESERVE_RPC, RELEASE_RPC]);
    expect(moneyEffects(result)).toEqual(NO_MONEY_EFFECTS);
  });

  it('answers 422 INVALID_CONNECT_ECONOMICS when shipping exceeds the price, after releasing', async () => {
    const result = await runCreateConnectPayment({
      products: [
        productRow({
          price_cents: 10_000,
          publication_shipping_reserve_cents: 20_000,
        }),
      ],
    });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: 'INVALID_CONNECT_ECONOMICS' });
    expect(result.rpcs).toEqual([RESERVE_RPC, RELEASE_RPC]);
    expect(result.calls.at(-1)).toBe('rpc:fn_release_products');
    expect(result.paymentIntentsCreate).toEqual([]);
  });

  it('answers 500 EPHEMERAL_KEY_FAILED without a key secret and creates no PaymentIntent', async () => {
    const result = await runCreateConnectPayment({ ephemeralSecret: null });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'EPHEMERAL_KEY_FAILED' });
    expect(result.paymentIntentsCreate).toEqual([]);
    expect(result.rpcs).toEqual([RESERVE_RPC]);
  });
});

describe('create-connect-payment handler: PaymentIntent failure and unmapped errors', () => {
  it('answers 500 PI_CREATION_FAILED and releases the reservation after the attempt', async () => {
    const result = await runCreateConnectPayment({ piError: 'card_declined' });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'PI_CREATION_FAILED' });
    expect(result.rpcs).toEqual([RESERVE_RPC, RELEASE_RPC]);
    expect(result.calls.slice(-2)).toEqual([
      'stripe.paymentIntents.create',
      'rpc:fn_release_products',
    ]);
  });

  it('keeps the PI_CREATION_FAILED answer when the release itself throws', async () => {
    const result = await runCreateConnectPayment({
      piError: 'card_declined',
      releaseThrows: 'network down',
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'PI_CREATION_FAILED' });
    expect(result.rpcs).toEqual([RESERVE_RPC, RELEASE_RPC]);
  });

  it('answers 400 with the builder error when Stripe returns no client secret', async () => {
    const result = await runCreateConnectPayment({ pi: { client_secret: '' } });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: 'INVALID_CHECKOUT_INPUT:missing_client_secret',
    });
    expect(result.rpcs).toEqual([RESERVE_RPC]);
  });

  it('answers 400 for an unmapped error and keeps its message', async () => {
    const result = await runCreateConnectPayment({
      sellerProfiles: [readySeller(SELLER_A)],
      products: [productRow({ price_cents: -1 })],
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: 'INVALID_CHECKOUT_INPUT:non_positive_subtotal',
    });
    expect(result.paymentIntentsCreate).toEqual([]);
  });

  it('answers 400 non_positive_subtotal for a zero price, after releasing, with no PaymentIntent', async () => {
    const result = await runCreateConnectPayment({
      products: [productRow({ price_cents: 0 })],
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: 'INVALID_CHECKOUT_INPUT:non_positive_subtotal',
    });
    expect(result.rpcs).toEqual([RESERVE_RPC, RELEASE_RPC]);
    expect(result.calls.at(-1)).toBe('rpc:fn_release_products');
    expect(result.paymentIntentsCreate).toEqual([]);
  });
});
