/**
 * @file supabase/functions/create-connect-payment/single-payment-builder.ts
 *
 * PURE, side-effect-free builders for the Phase 3 single-modal multi-seller
 * checkout. The buyer authorizes ONE platform-account PaymentIntent for the
 * full order total; seller economics stay internal and are released later via
 * shipment-scoped Transfers keyed by an order-level `transfer_group`.
 *
 * These functions are intentionally free of Stripe/Supabase/Deno imports so
 * they can be unit-tested with `bun test` (the `serve()` handler in `index.ts`
 * imports `https://deno.land/std` + `https://esm.sh`, which `bun test` cannot
 * resolve). `index.ts` wires these pure builders around the Stripe/Supabase
 * calls; all single-PI correctness lives here and is covered by tests.
 *
 * Contract guarantees (verified by `single-payment-builder.test.ts`):
 *  - exactly one PaymentIntent amount == allocation.buyerTotalCents
 *  - no `transfer_data.destination` (no automatic seller routing at PI time)
 *  - no `application_fee_amount` (manual release creates Transfers later)
 *  - no `payment_method_types` (automatic/dynamic payment methods per Stripe)
 *  - `transfer_group` in both PI metadata and the single-secret response
 *  - allocation JSON embedded in PI metadata, chunked to fit Stripe's 500-char
 *    metadata value limit
 *  - response is a single `{ orderId, clientSecret, customer, ephemeralKey,
 *    amount, transferGroup }` (no per-seller `paymentIntents[]`)
 */

import { createHash } from 'node:crypto';
import type { CheckoutAllocation } from './fee-calculator.ts';

/** Metadata `flow` value the webhook routes on (single-modal checkout). */
export const SINGLE_MODAL_FLOW = 'single_modal_connect_checkout';

/** Stripe metadata VALUE max length per key (Stripe enforces 500 chars). */
export const STRIPE_ALLOCATION_VALUE_MAX_LEN = 500;

/** Stripe transfer_group max length. */
const STRIPE_TRANSFER_GROUP_MAX_LEN = 100;

/**
 * Build a stable, Stripe-safe `transfer_group` for an order. Used as the
 * grouping key for per-shipment platform->seller Transfers on manual release.
 *
 * Stripe `transfer_group` is an arbitrary string up to 100 chars; a UUID-prefixed
 * value keeps it unique per checkout while staying deterministic for retries.
 */
export function buildTransferGroup(orderId: string): string {
  if (typeof orderId !== 'string' || orderId.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_order_id');
  }
  const group = `selene_order_${orderId}`;
  if (group.length > STRIPE_TRANSFER_GROUP_MAX_LEN) {
    throw new Error('INVALID_CHECKOUT_INPUT:transfer_group_too_long');
  }
  return group;
}

/**
 * Shape returned by the `fn_reserve_products` RPC when it succeeds without a
 * Postgrest error. The function can SOFT-FAIL (e.g. a product sold out between
 * the cart open and the reserve attempt) by returning `{ success: false }`
 * WITHOUT throwing — the Edge Function must treat that as a failed reservation
 * and block PaymentIntent creation. `assertReservationSucceeded` encodes that
 * contract as a pure, side-effect-free assertion.
 */
export interface ReservationResult {
  success: boolean;
  error_message?: string | null;
  total_price?: number | null;
}

export type ReservationRpcData = ReservationResult | ReservationResult[] | null;

export interface CreateConnectPaymentRequestItem {
  productId: string;
  quantity: 1;
}

export interface CreateConnectPaymentRequestBody {
  items?: CreateConnectPaymentRequestItem[];
  productIds?: string[];
  addressId: string;
  idempotencyKey?: string;
}

export interface NormalizedCreateConnectPaymentRequest {
  addressId: string;
  idempotencyKey?: string;
  productIds: string[];
}

function normalizeReservationRpcData(
  data: ReservationRpcData,
): ReservationResult | null {
  if (Array.isArray(data)) {
    return data[0] ?? null;
  }

  return data;
}

function uniqueProductIds(productIds: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const productId of productIds) {
    if (!seen.has(productId)) {
      seen.add(productId);
      unique.push(productId);
    }
  }

  return unique;
}

/**
 * Assert that a `fn_reserve_products` RPC call either succeeded. Throws
 * `RESERVATION_FAILED` (mapped to HTTP 409 by the Edge Function) when:
 *   - the RPC returned a Postgrest error, OR
 *   - the RPC returned `{ success: false }` without an error, OR
 *   - the RPC returned no data at all.
 *
 * Pure (no Stripe/Supabase side effects) so it is unit-tested directly — this
 * is the regression the review surfaced (the prior wiring only inspected
 * `reserveError` and let PI creation proceed on `success: false`).
 */
export function assertReservationSucceeded(result: {
  data: ReservationRpcData;
  error: { message: string } | null;
}): void {
  if (result.error) {
    throw new Error('RESERVATION_FAILED');
  }

  const reservation = normalizeReservationRpcData(result.data);

  if (reservation === null || reservation.success === false) {
    throw new Error('RESERVATION_FAILED');
  }
}

export function normalizeCreateConnectPaymentRequest(
  body: CreateConnectPaymentRequestBody,
): NormalizedCreateConnectPaymentRequest {
  const productIds = body.items?.length
    ? body.items.map((item) => item.productId)
    : (body.productIds ?? []);

  return {
    addressId: body.addressId,
    idempotencyKey: body.idempotencyKey,
    productIds: uniqueProductIds(productIds),
  };
}

export interface AllocationValidationRow {
  shipmentId: string;
  productIds: string[];
}

/**
 * Prevent a charged checkout from reaching settlement with grouped, missing, or
 * ambiguous product allocations. This is intentionally independent of Stripe
 * and Supabase so it can execute immediately before PaymentIntent creation.
 */
export function assertValidAllocationRows(input: {
  requestedProductIds: string[];
  rows: AllocationValidationRow[];
}): void {
  const requested = new Set(input.requestedProductIds);
  const allocated = new Set<string>();
  const shipmentIds = new Set<string>();

  if (
    requested.size !== input.requestedProductIds.length ||
    requested.size === 0
  ) {
    throw new Error('PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED');
  }

  for (const row of input.rows) {
    if (
      row.productIds.length !== 1 ||
      row.shipmentId.length === 0 ||
      shipmentIds.has(row.shipmentId)
    ) {
      throw new Error('ONE_PRODUCT_PER_SHIPMENT_REQUIRED');
    }

    const [productId] = row.productIds;
    if (!requested.has(productId) || allocated.has(productId)) {
      throw new Error('PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED');
    }

    shipmentIds.add(row.shipmentId);
    allocated.add(productId);
  }

  if (allocated.size !== requested.size) {
    throw new Error('ONE_PRODUCT_PER_SHIPMENT_REQUIRED');
  }
}

/**
 * Format a 32-hex-char (128-bit) string as an RFC-4122-style UUID
 * (8-4-4-4-12). The Postgres `uuid` column type validates FORMAT only, not
 * version/variant bits, so a deterministic hash-derived 128-bit value is
 * accepted. Deterministic: identical input always yields identical output.
 */
function hexToUuid(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}

/** Deterministic SHA-256 hex digest of a UTF-8 string. */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Derive a deterministic, UUID-format order-group id from a stable checkout
 * idempotency key. Two retries carrying the same idempotency key produce the
 * SAME orderGroupId — hence the same `transfer_group` and the same shipment
 * ids — so the Stripe PaymentIntent create request body is identical and
 * Stripe's request idempotency returns the existing PaymentIntent instead of
 * either minting a duplicate OR rejecting idempotency-key reuse.
 */
export function deriveOrderGroupId(idempotencyKey: string): string {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_idempotency_key');
  }
  return hexToUuid(sha256Hex(`selene_order_group:${idempotencyKey}`));
}

/**
 * Derive a deterministic, UUID-format shipment id for an (idempotency key,
 * product) pair. Stable per purchased listing on retry so the webhook persists
 * the same product shipment without collapsing listings from one seller.
 */
export function deriveShipmentId(
  idempotencyKey: string,
  productId: string,
): string {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_idempotency_key');
  }
  if (typeof productId !== 'string' || productId.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_product_id');
  }
  return hexToUuid(
    sha256Hex(`selene_shipment:${idempotencyKey}:product:${productId}`),
  );
}

export interface CheckoutIdentifiers {
  orderGroupId: string;
  transferGroup: string;
  /** Returns one stable shipment id per product (deterministic in idempotent mode). */
  shipmentIdFor: (productId: string) => string;
}

/**
 * Build the checkout identifiers (order-group id, transfer_group, per-product
 * shipment ids).
 *
 * - When `idempotencyKey` is provided, ALL identifiers are DETERMINISTIC
 *   functions of the idempotency key (+ product id). A retry of the same
 *   checkout produces an identical Stripe PaymentIntent create request body
 *   so Stripe's request idempotency returns the existing PaymentIntent — the
 *   unsafe "same idempotency key, different body" rejection is impossible.
 * - When `idempotencyKey` is absent (legacy path), identifiers are random via
 *   the injected `randomUuid` callback AND the Edge Function does NOT set a
 *   Stripe request idempotency key upstream — so there is no unsafe reuse.
 *
 * `randomUuid` is injected so this pure function stays deterministic and
 * testable without touching `crypto.randomUUID` at test time.
 */
export function buildCheckoutIdentifiers(
  idempotencyKey: string | undefined,
  randomUuid: () => string,
): CheckoutIdentifiers {
  if (idempotencyKey === undefined) {
    const orderGroupId = randomUuid();
    return {
      orderGroupId,
      transferGroup: buildTransferGroup(orderGroupId),
      shipmentIdFor: () => randomUuid(),
    };
  }
  if (idempotencyKey.length === 0) {
    // An empty key collides every retry → unsafe. Reject loudly.
    throw new Error('INVALID_CHECKOUT_INPUT:missing_idempotency_key');
  }
  const orderGroupId = deriveOrderGroupId(idempotencyKey);
  return {
    orderGroupId,
    transferGroup: buildTransferGroup(orderGroupId),
    shipmentIdFor: (productId: string) =>
      deriveShipmentId(idempotencyKey, productId),
  };
}

/**
 * Split a JSON string into chunks of at most `maxLen` characters for safe
 * embedding as multiple Stripe metadata values. Concatenation of chunks
 * (without separators) reproduces the original string — reassembly simply
 * joins `allocation_json_0 + allocation_json_1 + ...` before `JSON.parse`.
 */
export function chunkAllocationJson(
  json: string,
  maxLen: number = STRIPE_ALLOCATION_VALUE_MAX_LEN,
): string[] {
  if (typeof json !== 'string' || !Number.isFinite(maxLen) || maxLen <= 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:bad_metadata_chunk_args');
  }
  if (json.length === 0) return [''];
  const step = Math.max(1, Math.floor(maxLen));
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += step) {
    chunks.push(json.slice(i, i + step));
  }
  return chunks;
}

/**
 * Build Stripe metadata entries carrying the full per-shipment allocation as
 * chunked JSON, plus a `allocation_chunk_count` key the webhook reads to know
 * how many `allocation_json_N` keys to reassemble. Keeps total allocation
 * metadata keys well under Stripe's 50-key metadata budget.
 *
 * `sellerProductIds` (sellerId -> productIds[]) is FOLDED into each compact
 * allocation row so the webhook rebuilds order_items from the single
 * reassembled allocation blob. This lets us DROP the previously separate
 * `seller_ids`, `shipment_ids`, and `seller_product_ids` top-level metadata
 * keys — those could each exceed Stripe's 500-char per-value limit for many
 * sellers / many products (the product-id map is a tree).
 */
export function buildAllocationMetadata(
  allocation: CheckoutAllocation,
  shipmentProductIds: Record<string, string[]>,
): Record<string, string> {
  // Compact allocation representation: only the durable, webhook/release-relevant
  // fields. Aggregate totals also travel as individual metadata keys below.
  // productIds per seller are folded into rows so the webhook can build
  // order_items from the single reassembled allocation_json blob.
  //
  // productIds per row are SORTED (ascending) before embedding. The caller
  // (index.ts) builds the per-seller productIds array from a DB
  // `.in('id', productIds)` query whose return order is NOT guaranteed; a
  // retry of the same cart can reassemble each seller's productIds in a
  // different order, which would otherwise yield a different
  // `allocation_json` metadata blob and trip Stripe's idempotency-key
  // reuse-with-different-body rejection. Sorting per row makes the embedded
  // allocation JSON byte-deterministic for a given (seller set, product set)
  // regardless of DB fetch order — pairing with the row-order normalization
  // (sorted by sellerId) in `buildSinglePaymentIntentParams` so the whole
  // Stripe PaymentIntent create body is stable for a given cart.
  const compact = {
    rows: allocation.rows.map((r) => ({
      sellerId: r.sellerId,
      shipmentId: r.shipmentId,
      productIds: [
        ...(shipmentProductIds[r.shipmentId] ??
          shipmentProductIds[r.sellerId] ??
          []),
      ].sort(),
      grossCents: r.grossCents,
      commissionCents: r.commissionCents,
      shippingCents: r.shippingCents,
      seguroCents: r.seguroCents,
      netCents: r.netCents,
    })),
  };
  const json = JSON.stringify(compact);
  const chunks = chunkAllocationJson(json);

  const meta: Record<string, string> = {
    allocation_chunk_count: String(chunks.length),
  };
  chunks.forEach((chunk, i) => {
    meta[`allocation_json_${i}`] = chunk;
  });
  return meta;
}

export interface SinglePaymentIntentParamsInput {
  allocation: CheckoutAllocation;
  orderId: string;
  buyerId: string;
  customerId: string;
  addressId: string;
  transferGroup: string;
  /** shipmentId -> one purchased listing, aligned with allocation.rows. */
  shipmentProductIds?: Record<string, string[]>;
  /** @deprecated Only supports legacy one-shipment-per-seller metadata. */
  sellerProductIds?: Record<string, string[]>;
}

export interface SinglePaymentIntentParams {
  amount: number;
  currency: 'mxn';
  customer: string;
  /**
   * Top-level Stripe `transfer_group`. Stripe groups later Transfers created
   * with the same `transfer_group` under this PaymentIntent's charge, which is
   * what manual admin release uses to correlate per-shipment Transfers to the
   * original buyer charge. Mirrored in `metadata.transfer_group` so the webhook
   * can persist it on the order row.
   */
  transfer_group: string;
  automatic_payment_methods: { enabled: true };
  metadata: Record<string, string>;
}

/**
 * Build the params for the single platform-account PaymentIntent. Deliberately
 * omits `transfer_data.destination`, `application_fee_amount`, and
 * `payment_method_types`: seller funds are NOT routed at PI time, manual admin
 * release later creates per-shipment Transfers under `transfer_group`. Payment
 * methods are dynamic/automatic per the Stripe integration guidance (non-
 * Terminal flows must not hardcode `payment_method_types`).
 */
export function buildSinglePaymentIntentParams(
  input: SinglePaymentIntentParamsInput,
): SinglePaymentIntentParams {
  const {
    allocation,
    orderId,
    buyerId,
    customerId,
    addressId,
    transferGroup,
    sellerProductIds,
    shipmentProductIds = sellerProductIds ?? {},
  } = input;

  if (typeof orderId !== 'string' || orderId.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_order_id');
  }
  if (typeof buyerId !== 'string' || buyerId.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_buyer_id');
  }
  if (typeof customerId !== 'string' || customerId.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_customer_id');
  }
  if (typeof transferGroup !== 'string' || transferGroup.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_transfer_group');
  }

  const rows = allocation.rows;

  // Normalize allocation rows to a STABLE order (sorted by sellerId) before
  // emitting metadata. The caller (index.ts) iterates a Map populated from a
  // DB product query whose `.in('id', productIds)` order is NOT guaranteed, so
  // a retry of the same checkout could otherwise assemble allocation rows in a
  // different order and produce a different `allocation_json` metadata blob —
  // which Stripe rejects as idempotency-key reuse with different params.
  // Sorting by sellerId makes the Stripe PaymentIntent create body byte-
  // deterministic for a given cart, so retry idempotency is safe.
  const normalizedAllocation: CheckoutAllocation = {
    ...allocation,
    rows: [...rows].sort(
      (a, b) =>
        a.sellerId.localeCompare(b.sellerId) ||
        a.shipmentId.localeCompare(b.shipmentId),
    ),
  };

  const metadata: Record<string, string> = {
    app_name: 'selene',
    flow: SINGLE_MODAL_FLOW,
    transfer_group: transferGroup,
    order_id: orderId,
    order_group_id: orderId,
    buyer_id: buyerId,
    address_id: addressId,
    total_sellers: String(rows.length),
    buyer_total_cents: String(allocation.buyerTotalCents),
    grossed_up_total_cents: String(allocation.buyerTotalCents),
    domestic_seguro_cents: String(allocation.totalSeguroCents),
    total_gross_cents: String(allocation.totalGrossCents),
    total_commission_cents: String(allocation.totalCommissionCents),
    total_shipping_cents: String(allocation.totalShippingCents),
    total_seguro_cents: String(allocation.totalSeguroCents),
    total_release_cents: String(allocation.totalReleaseCents),
    // seller_ids / shipment_ids / seller_product_ids are intentionally NOT
    // top-level metadata keys: they would each exceed Stripe's 500-char
    // per-value limit for many sellers / many products. They fold into the
    // chunked allocation_json rows (productIds per row) and remain reachable
    // via the single reassembled allocation blob.
  };

  Object.assign(
    metadata,
    buildAllocationMetadata(normalizedAllocation, shipmentProductIds),
  );

  return {
    amount: allocation.buyerTotalCents,
    currency: 'mxn',
    customer: customerId,
    transfer_group: transferGroup,
    automatic_payment_methods: { enabled: true },
    metadata,
  };
}

export interface CreateConnectPaymentResponseBuilderInput {
  orderId: string;
  customerId: string;
  ephemeralKeySecret: string;
  transferGroup: string;
}

export interface StripePaymentIntentLike {
  client_secret: string;
  amount: number;
}

/**
 * Shape the single-secret create-connect-payment response from the created
 * Stripe PaymentIntent + the order/customer/transfer-group context. Returns
 * exactly one `clientSecret`, one `transferGroup`, and the buyer-visible
 * amount — never a per-seller `paymentIntents[]` array.
 */
export function buildCreateConnectPaymentResponse(
  pi: StripePaymentIntentLike,
  ctx: CreateConnectPaymentResponseBuilderInput,
): {
  orderId: string;
  clientSecret: string;
  customer: string;
  ephemeralKey: string;
  amount: number;
  transferGroup: string;
} {
  if (typeof pi.client_secret !== 'string' || pi.client_secret.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:missing_client_secret');
  }
  return {
    orderId: ctx.orderId,
    clientSecret: pi.client_secret,
    customer: ctx.customerId,
    ephemeralKey: ctx.ephemeralKeySecret,
    amount: pi.amount,
    transferGroup: ctx.transferGroup,
  };
}
