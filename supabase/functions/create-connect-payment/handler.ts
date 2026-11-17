/**
 * @file supabase/functions/create-connect-payment/handler.ts
 *
 * Single-modal multi-seller checkout PaymentIntent orchestrator (CON-003,
 * Phase 3 single-PI rewrite).
 *
 * Creates ONE platform-account PaymentIntent in MXN for the full buyer-visible
 * order total, keyed by an order-level `transfer_group` that the manual admin
 * release later uses to correlate per-shipment platform->seller Transfers.
 *
 * Seller economics (commission, seller-paid shipping, seguro, seller net) stay
 * internal: they are computed via `calculateCheckoutAllocation` and embedded in
 * the PaymentIntent metadata as chunked JSON so the webhook can persist
 * per-shipment allocation idempotently. No Stripe `Transfer` or `Payout` is
 * created here — manual release controls seller cash-out after shipment
 * completion. Auto-routing to seller accounts at PI time is INTENTIONALLY
 * removed: the PaymentIntent omits `transfer_data.destination` and
 * `application_fee_amount`.
 *
 * The single-PI correctness (amount math, metadata shape, transfer_group,
 * allocation chunking, single-secret response) lives in the pure, side-effect-
 * free `single-payment-builder.ts` module, which is unit-tested with `bun test`.
 * This file only wires Stripe/Supabase side effects around those builders;
 * `index.ts` injects the real clients.
 *
 * Auth: authenticated buyer only.
 */

import type { SupabaseClient } from '../_shared/supabase-js.ts';
import type Stripe from '../_shared/stripe/sdk.ts';
import { STRIPE_API_VERSION } from '../_shared/stripe/api-version.ts';
import { z } from '../_shared/zod-runtime.ts';
import {
  assertValidCheckoutAllocation,
  calculateCheckoutAllocation,
  type SellerAllocationInput,
} from './fee-calculator.ts';
import {
  validatePublicationEconomicsSnapshot,
  type PublicationEconomicsSnapshot,
} from '../_shared/stripe/publication-economics.ts';
import {
  assertReservationSucceeded,
  assertValidAllocationRows,
  buildCheckoutIdentifiers,
  buildCreateConnectPaymentResponse,
  createSinglePaymentIntent,
  buildSinglePaymentIntentParams,
  normalizeCreateConnectPaymentRequest,
  type ReservationRpcData,
} from './single-payment-builder.ts';
import {
  findSellersNotReadyForPayment,
  type SellerPaymentProfile,
} from './seller-payment-readiness.ts';

const APP_NAME = 'selene';

const ItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.literal(1).default(1),
});

const RequestSchema = z
  .object({
    items: z.array(ItemSchema).min(1).max(50).optional(),
    productIds: z.array(z.string().uuid()).min(1).max(50).optional(),
    addressId: z.string().uuid(),
    /**
     * Optional client-supplied idempotency key. When provided, it becomes the
     * Stripe request idempotency key for PaymentIntent creation so a retry of
     * the same checkout attempt does not create a duplicate PaymentIntent.
     */
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .refine((body) => Boolean(body.items?.length || body.productIds?.length), {
    message: 'items or productIds is required',
  });

const log = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  meta?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'create-connect-payment',
      level,
      msg,
      ...meta,
    }),
  );
};

const summarizeProductIds = (productIds: string[]) =>
  productIds.slice(0, 6).map((productId) => productId.slice(0, 8));

const describeReservationRpcData = (data: ReservationRpcData) => ({
  rpcShape: Array.isArray(data)
    ? 'array'
    : data === null
      ? 'null'
      : typeof data,
  rpcSuccess: Array.isArray(data)
    ? (data[0]?.success ?? null)
    : (data?.success ?? null),
  rpcErrorMessage: Array.isArray(data)
    ? (data[0]?.error_message ?? null)
    : (data?.error_message ?? null),
});

export type SupabaseAdminClient = SupabaseClient;
export type CreateConnectPaymentStripeClient = Pick<
  Stripe,
  'customers' | 'ephemeralKeys' | 'paymentIntents'
>;

export interface CreateConnectPaymentDependencies {
  // Read on every request: STRIPE_SECRET_KEY and SUPABASE_URL.
  getEnv: (name: string) => string | undefined;
  readSupabaseSecretKey: () => string | undefined;
  // Both clients are created once per request, before the caller is
  // authenticated, and only when every secret is present.
  createStripe: (stripeSecret: string) => CreateConnectPaymentStripeClient;
  createSupabaseAdmin: (
    supabaseUrl: string,
    supabaseSecretKey: string,
  ) => SupabaseAdminClient;
  // Random order-group and shipment ids when the client sends no idempotency key.
  randomUUID: () => string;
}

export function createCreateConnectPaymentHandler(
  deps: CreateConnectPaymentDependencies,
) {
  return async (req: Request): Promise<Response> => {
    try {
      // 1. Secrets
      const stripeSecret = deps.getEnv('STRIPE_SECRET_KEY');
      const supabaseSecretKey = deps.readSupabaseSecretKey();
      const supabaseUrl = deps.getEnv('SUPABASE_URL');
      if (!stripeSecret || !supabaseSecretKey || !supabaseUrl) {
        throw new Error('MISSING_SERVER_CONFIG');
      }

      const stripe = deps.createStripe(stripeSecret);

      const supabaseAdmin = deps.createSupabaseAdmin(
        supabaseUrl,
        supabaseSecretKey,
      );

      // 2. Auth
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) throw new Error('AUTH_REQUIRED');

      const {
        data: { user },
        error: authError,
      } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) throw new Error('AUTH_REQUIRED');

      // 3. Validate input
      const body = await req.json().catch(() => ({}));
      const parsedBody = RequestSchema.parse(body);
      const normalizedRequest =
        normalizeCreateConnectPaymentRequest(parsedBody);
      const items = normalizedRequest.productIds.map((productId) => ({
        productId,
        quantity: 1 as const,
      }));

      // 3b. Build stable checkout identifiers. When the client supplies an
      // idempotency key, the order-group id, transfer_group, and the per-seller
      // shipment ids are DETERMINISTIC functions of that key (+ seller id) so a
      // retry of the same checkout produces a byte-identical Stripe PaymentIntent
      // create request and Stripe's request idempotency returns the existing
      // PaymentIntent instead of rejecting idempotency-key reuse (or minting a
      // duplicate charge). Without an idempotency key, identifiers are random
      // and NO Stripe request idempotency key is set below — no unsafe reuse.
      const { orderGroupId, transferGroup, shipmentIdFor } =
        buildCheckoutIdentifiers(parsedBody.idempotencyKey, () =>
          deps.randomUUID(),
        );

      const releaseReserved = async (reason: string) => {
        try {
          await supabaseAdmin.rpc('fn_release_products', {
            p_product_ids: productIds,
          });
        } catch (err: unknown) {
          log('error', 'failed to release reserved products', {
            reason,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      // 4. Reserve products. fn_reserve_products can soft-fail by returning
      // { success: false } WITHOUT throwing a Postgrest error (e.g. a product
      // sold out between cart open and reserve). The pure assertion encodes
      // that contract and blocks PaymentIntent creation on both error paths.
      const productIds = items.map((i) => i.productId);
      log('info', 'Attempting product reservation', {
        buyerId: user.id,
        productCount: productIds.length,
        productIdPreview: summarizeProductIds(productIds),
        hasIdempotencyKey: Boolean(normalizedRequest.idempotencyKey),
      });
      const { data: reserveData, error: reserveError } =
        await supabaseAdmin.rpc('fn_reserve_products', {
          p_product_ids: productIds,
          p_buyer_id: user.id,
        });
      log('info', 'Product reservation RPC completed', {
        buyerId: user.id,
        productCount: productIds.length,
        productIdPreview: summarizeProductIds(productIds),
        ...describeReservationRpcData(reserveData as ReservationRpcData),
        postgrestErrorMessage: reserveError?.message ?? null,
        postgrestErrorCode: reserveError?.code ?? null,
      });
      try {
        assertReservationSucceeded({
          data: reserveData as ReservationRpcData,
          error: reserveError,
        });
      } catch (reservationError) {
        log('error', 'Product reservation failed', {
          buyerId: user.id,
          productCount: productIds.length,
          productIdPreview: summarizeProductIds(productIds),
          ...describeReservationRpcData(reserveData as ReservationRpcData),
          postgrestErrorMessage: reserveError?.message ?? null,
          postgrestErrorCode: reserveError?.code ?? null,
          error:
            reservationError instanceof Error
              ? reservationError.message
              : String(reservationError),
        });
        throw reservationError instanceof Error
          ? reservationError
          : new Error('RESERVATION_FAILED');
      }

      // 5. Load product details for the reserved items
      const { data: products, error: productsError } = await supabaseAdmin
        .from('products')
        .select(
          'id, seller_id, price_cents, name, publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate',
        )
        .in('id', productIds);
      if (productsError || !products?.length) {
        await releaseReserved('PRODUCTS_NOT_FOUND');
        throw new Error('PRODUCTS_NOT_FOUND');
      }

      // 6. Build one allocation for every purchased listing. A seller can own
      // multiple listings in an order, but each keeps an independent shipment,
      // label, tracking, and payout boundary. Each listing is priced only from
      // the economics frozen into it at publication; a listing without a valid
      // snapshot fails checkout instead of falling back to current settings.
      const productAllocations: Array<{
        productId: string;
        sellerId: string;
        subtotalCents: number;
        shippingCents: number;
        publicationSnapshot: PublicationEconomicsSnapshot;
      }> = [];

      for (const product of products) {
        const item = items.find((i) => i.productId === product.id);
        if (!item) continue;

        const publicationSnapshot: PublicationEconomicsSnapshot = {
          publication_shipping_reserve_cents:
            product.publication_shipping_reserve_cents,
          publication_commission_rate: product.publication_commission_rate,
          publication_insurance_rate: product.publication_insurance_rate,
        };
        let shippingReserveCents: number;
        try {
          ({ shippingReserveCents } =
            validatePublicationEconomicsSnapshot(publicationSnapshot));
        } catch {
          log('error', 'Product has no valid publication economics snapshot', {
            productIdPreview: summarizeProductIds([product.id]),
          });
          await releaseReserved('INVALID_PUBLICATION_ECONOMICS_SNAPSHOT');
          throw new Error('INVALID_PUBLICATION_ECONOMICS_SNAPSHOT');
        }

        productAllocations.push({
          productId: product.id,
          sellerId: product.seller_id,
          subtotalCents: product.price_cents * item.quantity,
          shippingCents: shippingReserveCents,
          publicationSnapshot,
        });
      }

      // 7. Load Connect accounts for all sellers
      const sellerIds = [
        ...new Set(productAllocations.map((row) => row.sellerId)),
      ];
      const { data: sellerProfiles, error: profilesError } = await supabaseAdmin
        .from('profiles_private')
        .select('id, stripe_account_id, stripe_onboarding_status')
        .in('id', sellerIds);
      if (profilesError) {
        await releaseReserved('PROFILES_LOAD_FAILED');
        throw new Error('PROFILES_LOAD_FAILED');
      }

      // 8. Validate all sellers finished Connect onboarding (manual release
      // needs payout-ready accounts; fail fast before charging the buyer).
      const notOnboarded = findSellersNotReadyForPayment(
        sellerIds,
        (sellerProfiles || []) as SellerPaymentProfile[],
      );
      if (notOnboarded.length > 0) {
        log('warn', 'Checkout blocked: seller not ready for payment', {
          buyerId: user.id,
          sellerCount: notOnboarded.length,
        });
        await releaseReserved('SELLER_NOT_ONBOARDED');
        throw new Error('SELLER_NOT_ONBOARDED');
      }

      // 9. Get/create Stripe customer for buyer + ephemeral key for mobile SDK
      let customerId: string;
      const { data: buyerProfile } = await supabaseAdmin
        .from('profiles_private')
        .select('stripe_customer_id, email')
        .eq('id', user.id)
        .single();

      if (buyerProfile?.stripe_customer_id) {
        customerId = buyerProfile.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          email: buyerProfile?.email ?? user.email,
          metadata: { supabase_user_id: user.id, app_name: APP_NAME },
        });
        customerId = customer.id;
        await supabaseAdmin
          .from('profiles_private')
          .update({ stripe_customer_id: customerId })
          .eq('id', user.id);
      }

      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: customerId },
        { apiVersion: STRIPE_API_VERSION },
      );
      // Stripe returns the secret only on create, and the PaymentSheet needs it.
      const ephemeralKeySecret = ephemeralKey.secret;
      if (!ephemeralKeySecret) throw new Error('EPHEMERAL_KEY_FAILED');

      // 10. Build the per-product allocation inputs with durable shipment ids, then
      // compute + validate the single-modal allocation. `shipmentId` correlation
      // is required by the allocation contract so manual release can address each
      // seller net to exactly one shipment.
      const allocationInputs: SellerAllocationInput[] = [];
      const shipmentProductIds: Record<string, string[]> = {};
      for (const product of productAllocations) {
        // Deterministic per (idempotencyKey, productId) when an idempotency key
        // was supplied; random (via the injected randomUUID) otherwise.
        // Stable-on-retry shipment ids correlate the per-seller allocation row
        // to the shipment the webhook will persist — no implicit ordering reliance.
        const shipmentId = shipmentIdFor(product.productId);
        allocationInputs.push({
          sellerId: product.sellerId,
          shipmentId,
          subtotalCents: product.subtotalCents,
          shippingCents: product.shippingCents,
          publicationSnapshot: product.publicationSnapshot,
        });
        shipmentProductIds[shipmentId] = [product.productId];
      }

      let allocation;
      try {
        assertValidAllocationRows({
          requestedProductIds: productIds,
          rows: Object.entries(shipmentProductIds).map(
            ([shipmentId, allocatedProductIds]) => ({
              shipmentId,
              productIds: allocatedProductIds,
            }),
          ),
        });
        allocation = calculateCheckoutAllocation(allocationInputs);
        assertValidCheckoutAllocation(allocation);
      } catch (economicsError) {
        await releaseReserved('INVALID_CONNECT_ECONOMICS');
        log('warn', 'Invalid Connect seller economics', {
          error:
            economicsError instanceof Error
              ? economicsError.message
              : String(economicsError),
        });
        throw economicsError instanceof Error
          ? economicsError
          : new Error('INVALID_CONNECT_ECONOMICS');
      }

      // 11. Build the single platform PaymentIntent params and create the PI.
      // No `transfer_data.destination`, no `application_fee_amount`: seller funds
      // are NOT routed at PI time; manual release later creates per-shipment
      // Transfers under `transfer_group`. Cards only, fixed by the builder so
      // the Dashboard cannot add a method the refund paths cannot handle (#567).
      const piParams = buildSinglePaymentIntentParams({
        allocation,
        orderId: orderGroupId,
        buyerId: user.id,
        customerId,
        addressId: normalizedRequest.addressId,
        transferGroup,
        shipmentProductIds,
      });

      const requestParams: Stripe.PaymentIntentCreateParams = {
        amount: piParams.amount,
        currency: piParams.currency,
        customer: piParams.customer,
        transfer_group: piParams.transfer_group,
        allowed_payment_method_types: piParams.allowed_payment_method_types,
        metadata: piParams.metadata,
      };

      // Stripe request idempotency: when the client retries the same checkout
      // attempt, reuse the same key so Stripe returns the existing PI instead of
      // minting a duplicate. This preserves the legacy retry-safety guarantee.
      let pi: Stripe.PaymentIntent;
      try {
        pi = await createSinglePaymentIntent({
          stripe,
          params: requestParams,
          idempotencyKey: normalizedRequest.idempotencyKey,
        });
        log('info', 'Single platform PaymentIntent created', {
          piId: pi.id,
          amount: pi.amount,
          transferGroup,
          sellerCount: allocation.rows.length,
        });
      } catch (piError) {
        log(
          'error',
          'Single PaymentIntent creation failed — releasing reservation',
          {
            error: piError instanceof Error ? piError.message : String(piError),
          },
        );
        // No prior PIs to cancel (single PI). Release the product reservation so
        // the cart is buyable again; the failed PI (if Stripe created one before
        // throwing) is left in `requires_payment_method` and never confirmed.
        await releaseReserved('PI_CREATION_FAILED');
        throw new Error('PI_CREATION_FAILED');
      }

      // 12. Return the single-secret response. Exactly one clientSecret, one
      // transferGroup, one amount — never a per-seller paymentIntents[] array.
      const response = buildCreateConnectPaymentResponse(pi, {
        orderId: orderGroupId,
        customerId,
        ephemeralKeySecret,
        transferGroup,
      });

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', 'create-connect-payment failed', { message });

      const statusMap: Record<string, number> = {
        AUTH_REQUIRED: 401,
        SELLER_NOT_ONBOARDED: 400,
        RESERVATION_FAILED: 409,
        PRODUCTS_NOT_FOUND: 404,
        PROFILES_LOAD_FAILED: 500,
        PI_CREATION_FAILED: 500,
        EPHEMERAL_KEY_FAILED: 500,
        MISSING_SERVER_CONFIG: 500,
        INVALID_CONNECT_ECONOMICS: 422,
        INVALID_PUBLICATION_ECONOMICS_SNAPSHOT: 500,
        ONE_PRODUCT_PER_SHIPMENT_REQUIRED: 422,
        PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED: 422,
        'INVALID_CHECKOUT_INPUT:missing_shipment_id': 422,
        'INVALID_CHECKOUT_INPUT:duplicate_shipment_id': 422,
        'INVALID_CHECKOUT_INPUT:missing_order_id': 422,
        'INVALID_CHECKOUT_INPUT:missing_transfer_group': 422,
        'INVALID_CHECKOUT_INPUT:transfer_group_too_long': 422,
        'INVALID_ALLOCATION_RECONCILIATION:missing_shipment_id': 500,
        'INVALID_ALLOCATION_RECONCILIATION:duplicate_shipment_id': 500,
        'INVALID_ALLOCATION_RECONCILIATION:negative_net': 500,
        'INVALID_ALLOCATION_RECONCILIATION:row_breakdown': 500,
        'INVALID_ALLOCATION_RECONCILIATION:buyer_total': 500,
      };
      const status = statusMap[message] || 400;

      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
