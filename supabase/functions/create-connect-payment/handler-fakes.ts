// Recording fakes for the create-connect-payment handler tests (bun:test).
// They stand in for the Supabase admin client and the Stripe client so a test
// can call the real handler and assert every effect it causes.
import {
  createCreateConnectPaymentHandler,
  type CreateConnectPaymentStripeClient,
  type SupabaseAdminClient,
} from './handler.ts';
import { calculateCheckoutAllocation } from './fee-calculator.ts';
import {
  buildSinglePaymentIntentParams,
  buildTransferGroup,
} from './single-payment-builder.ts';

export const BUYER_ID = 'buyer-1';
export const SELLER_A = 'seller-a';
export const SELLER_B = 'seller-b';
export const PRODUCT_1 = '11111111-1111-4111-8111-111111111111';
export const PRODUCT_2 = '22222222-2222-4222-8222-222222222222';
export const ADDRESS_ID = '33333333-3333-4333-8333-333333333333';
export const SUPABASE_URL = 'http://supabase.test';
export const SUPABASE_SECRET = 'sb_secret_test';
export const STRIPE_SECRET = 'sk_test_fake';
export const CUSTOMER_ID = 'cus_existing';

export const PRODUCTS_SELECT =
  'id, seller_id, price_cents, name, shipping_cost_cents, publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate';

type Row = Record<string, unknown>;
type DbResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

export const productRow = (overrides: Row = {}): Row => ({
  id: PRODUCT_1,
  seller_id: SELLER_A,
  price_cents: 123_450,
  name: 'GPU',
  shipping_cost_cents: 15_000,
  publication_shipping_reserve_cents: 15_000,
  publication_commission_rate: 0.06,
  publication_insurance_rate: 0.012,
  ...overrides,
});

export const readySeller = (id: string): Row => ({
  id,
  stripe_account_id: `acct_${id}`,
  stripe_onboarding_status: 'complete',
});

export interface RunOptions {
  /** Overrides for STRIPE_SECRET_KEY and SUPABASE_URL; `undefined` removes one. */
  env?: Record<string, string | undefined>;
  supabaseSecretKey?: string | undefined;
  /** `null` sends no Authorization header. */
  authorization?: string | null;
  /** What `auth.getUser` resolves; `null` is no user. */
  user?: { id: string; email?: string } | null;
  authError?: string;
  body?: unknown;
  /** Sent as the raw request body instead of `JSON.stringify(body)`. */
  rawBody?: string;
  reserve?: DbResult;
  release?: DbResult;
  /** `fn_release_products` throws with this message. */
  releaseThrows?: string;
  products?: Row[] | null;
  productsError?: string;
  settings?: Row | null;
  settingsError?: string;
  backfill?: DbResult;
  sellerProfiles?: Row[] | null;
  profilesError?: string;
  buyerProfile?: Row | null;
  customerUpdateError?: string;
  newCustomerId?: string;
  /** `null` makes Stripe return an ephemeral key without a secret. */
  ephemeralSecret?: string | null;
  piError?: string;
  pi?: Row;
  /** Values `randomUUID` returns, in order. */
  uuids?: string[];
}

export interface Query {
  table: string;
  ops: unknown[][];
}

export async function runCreateConnectPayment(options: RunOptions = {}) {
  // Every client, auth, database and Stripe call, in order.
  const calls: string[] = [];
  const queries: Query[] = [];
  const rpcs: { name: string; args: unknown }[] = [];
  const tokens: string[] = [];
  const envReads: string[] = [];
  const supabaseClients: unknown[][] = [];
  const stripeClients: string[] = [];
  const customersCreate: unknown[][] = [];
  const ephemeralKeysCreate: unknown[][] = [];
  const paymentIntentsCreate: unknown[][] = [];
  const uuids = [
    ...(options.uuids ?? ['uuid-1', 'uuid-2', 'uuid-3', 'uuid-4']),
  ];

  const env: Record<string, string | undefined> = {
    STRIPE_SECRET_KEY: STRIPE_SECRET,
    SUPABASE_URL,
    ...options.env,
  };

  const tableResult = (query: Query): DbResult => {
    const { table, ops } = query;
    const selected = ops.find(([op]) => op === 'select')?.[1];
    if (table === 'products') {
      if (options.productsError) {
        return { data: null, error: { message: options.productsError } };
      }
      return {
        data:
          options.products === undefined ? [productRow()] : options.products,
        error: null,
      };
    }
    if (table === 'system_settings') {
      if (options.settingsError) {
        return { data: null, error: { message: options.settingsError } };
      }
      return {
        data:
          options.settings === undefined
            ? {
                shipping_buffer_cents: 3000,
                insurance_rate: 1.2,
                service_fee_pct: 6,
              }
            : options.settings,
        error: null,
      };
    }
    if (table === 'profiles_private') {
      if (ops.some(([op]) => op === 'update')) {
        return {
          data: null,
          error: options.customerUpdateError
            ? { message: options.customerUpdateError }
            : null,
        };
      }
      if (selected === 'id, stripe_account_id, stripe_onboarding_status') {
        if (options.profilesError) {
          return { data: null, error: { message: options.profilesError } };
        }
        return {
          data:
            options.sellerProfiles === undefined
              ? [readySeller(SELLER_A), readySeller(SELLER_B)]
              : options.sellerProfiles,
          error: null,
        };
      }
      return {
        data:
          options.buyerProfile === undefined
            ? { stripe_customer_id: CUSTOMER_ID, email: 'buyer@example.test' }
            : options.buyerProfile,
        error: null,
      };
    }
    throw new Error(`unexpected table ${table}`);
  };

  const builder = (table: string) => {
    const query: Query = { table, ops: [] };
    queries.push(query);
    calls.push(`from:${table}`);
    const settle = () => Promise.resolve(tableResult(query));
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'in', 'eq', 'update']) {
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
    chain.then = (
      resolve: (value: DbResult) => unknown,
      reject: (reason: unknown) => unknown,
    ) => settle().then(resolve, reject);
    return chain;
  };

  const rpcResult = (name: string): DbResult => {
    if (name === 'fn_reserve_products') {
      return options.reserve ?? { data: [{ success: true }], error: null };
    }
    if (name === 'fn_release_products') {
      if (options.releaseThrows) throw new Error(options.releaseThrows);
      return options.release ?? { data: null, error: null };
    }
    if (name === 'backfill_product_publication_economics') {
      return (
        options.backfill ?? {
          data: [
            {
              publication_shipping_reserve_cents: 9_000,
              publication_commission_rate: 0.06,
              publication_insurance_rate: 0.012,
            },
          ],
          error: null,
        }
      );
    }
    throw new Error(`unexpected rpc ${name}`);
  };

  const supabase = {
    auth: {
      getUser: async (token: string) => {
        calls.push('auth.getUser');
        tokens.push(token);
        const user =
          options.user === undefined
            ? { id: BUYER_ID, email: 'auth@example.test' }
            : options.user;
        return {
          data: { user },
          error: options.authError ? { message: options.authError } : null,
        };
      },
    },
    from: (table: string) => builder(table),
    rpc: async (name: string, args: unknown) => {
      calls.push(`rpc:${name}`);
      rpcs.push({ name, args });
      return rpcResult(name);
    },
  };

  const stripe = {
    customers: {
      create: async (...args: unknown[]) => {
        calls.push('stripe.customers.create');
        customersCreate.push(args);
        return { id: options.newCustomerId ?? 'cus_new' };
      },
    },
    ephemeralKeys: {
      create: async (...args: unknown[]) => {
        calls.push('stripe.ephemeralKeys.create');
        ephemeralKeysCreate.push(args);
        return {
          id: 'ephkey_1',
          secret:
            options.ephemeralSecret === undefined
              ? 'ek_secret'
              : (options.ephemeralSecret ?? undefined),
        };
      },
    },
    paymentIntents: {
      create: async (...args: unknown[]) => {
        calls.push('stripe.paymentIntents.create');
        paymentIntentsCreate.push(args);
        if (options.piError) throw new Error(options.piError);
        const params = args[0] as { amount: number };
        return {
          id: 'pi_1',
          amount: params.amount,
          client_secret: 'pi_1_secret',
          ...options.pi,
        };
      },
    },
  };

  const handler = createCreateConnectPaymentHandler({
    getEnv: (name) => {
      envReads.push(name);
      return env[name];
    },
    readSupabaseSecretKey: () =>
      'supabaseSecretKey' in options
        ? options.supabaseSecretKey
        : SUPABASE_SECRET,
    createStripe: (secret) => {
      calls.push('createStripe');
      stripeClients.push(secret);
      return stripe as unknown as CreateConnectPaymentStripeClient;
    },
    createSupabaseAdmin: (url, key) => {
      calls.push('createSupabaseAdmin');
      supabaseClients.push([url, key]);
      return supabase as unknown as SupabaseAdminClient;
    },
    randomUUID: () => {
      const next = uuids.shift();
      if (!next) throw new Error('no more fake uuids');
      return next;
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const authorization =
    options.authorization === undefined
      ? 'Bearer user-token'
      : options.authorization;
  if (authorization !== null) headers.Authorization = authorization;

  const body =
    options.rawBody ??
    JSON.stringify(
      options.body === undefined
        ? { productIds: [PRODUCT_1], addressId: ADDRESS_ID }
        : options.body,
    );

  const originalLog = console.log;
  console.log = () => {};
  let response: Response;
  try {
    response = await handler(
      new Request('http://functions.test/create-connect-payment', {
        method: 'POST',
        headers,
        body,
      }),
    );
  } finally {
    console.log = originalLog;
  }

  return {
    status: response.status,
    contentType: response.headers.get('Content-Type'),
    body: (await response.json()) as Record<string, unknown>,
    calls,
    queries,
    rpcs,
    tokens,
    envReads,
    supabaseClients,
    stripeClients,
    customersCreate,
    ephemeralKeysCreate,
    paymentIntentsCreate,
  };
}

/** The effects every rejected request must leave untouched. */
export function moneyEffects(
  result: Awaited<ReturnType<typeof runCreateConnectPayment>>,
) {
  return {
    customers: result.customersCreate.length,
    ephemeralKeys: result.ephemeralKeysCreate.length,
    paymentIntents: result.paymentIntentsCreate.length,
    writes: result.queries.filter((q) => q.ops.some(([op]) => op === 'update'))
      .length,
  };
}

/** Reassembles the chunked `allocation_json_N` metadata the webhook reads. */
export function allocationRowsFromMetadata(metadata: Record<string, string>) {
  const count = Number(metadata.allocation_chunk_count);
  const json = Array.from(
    { length: count },
    (_, i) => metadata[`allocation_json_${i}`],
  ).join('');
  return (JSON.parse(json) as { rows: Row[] }).rows;
}

export interface ExpectedProduct {
  productId: string;
  sellerId: string;
  shipmentId: string;
  subtotalCents: number;
  snapshot: {
    publication_shipping_reserve_cents: number;
    publication_commission_rate: number;
    publication_insurance_rate: number;
  };
}

/** The PaymentIntent create params the handler must send for these inputs. */
export function expectedPaymentIntentParams(input: {
  products: ExpectedProduct[];
  orderId: string;
  customerId: string;
}) {
  const allocation = calculateCheckoutAllocation(
    input.products.map((product) => ({
      sellerId: product.sellerId,
      shipmentId: product.shipmentId,
      subtotalCents: product.subtotalCents,
      shippingCents: product.snapshot.publication_shipping_reserve_cents,
      publicationSnapshot: product.snapshot,
    })),
  );
  return buildSinglePaymentIntentParams({
    allocation,
    orderId: input.orderId,
    buyerId: BUYER_ID,
    customerId: input.customerId,
    addressId: ADDRESS_ID,
    transferGroup: buildTransferGroup(input.orderId),
    shipmentProductIds: Object.fromEntries(
      input.products.map((product) => [
        product.shipmentId,
        [product.productId],
      ]),
    ),
  });
}

export const DEFAULT_SNAPSHOT = {
  publication_shipping_reserve_cents: 15_000,
  publication_commission_rate: 0.06,
  publication_insurance_rate: 0.012,
};
