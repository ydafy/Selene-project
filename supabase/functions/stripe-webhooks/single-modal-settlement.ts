/**
 * @file supabase/functions/stripe-webhooks/single-modal-settlement.ts
 *
 * PURE, side-effect-free settlement helpers for the Phase 4 single-modal
 * multi-seller checkout webhook path. The buyer authorizes ONE platform-
 * account PaymentIntent; seller economics stay internal and are released
 * later via shipment-scoped Transfers keyed by an order-level
 * `transfer_group`.
 *
 * The Stripe PI metadata embeds the per-shipment allocation as chunked JSON
 * (built by `create-connect-payment/single-payment-builder.ts`). This module
 * reassembles + validates that metadata, parses a structured settlement
 * payload, routes the webhook to the correct flow, and maps the settlement
 * RPC result to a retry-safe HTTP outcome.
 *
 * The module is intentionally free of Deno/Stripe/Supabase imports so it can
 * be unit-tested with `bun test`. `index.ts` only wires `supabaseAdmin.rpc`
 * calls around these pure helpers — the same extraction pattern used for the
 * Phase 3 single-PI builders.
 *
 * Contract guarantees (verified by `single-modal-settlement.test.ts`):
 *  - chunked allocation JSON is reassembled ONLY when ALL declared chunks are
 *    present and the joined blob parses into the expected allocation envelope
 *  - the allocation envelope is structurally validated (rows, per-row fields,
 *    unique shipmentId correlation, per-row gross==commission+shipping+net)
 *  - top-level totals metadata cross-reconcile against the reassembled rows
 *  - webhook routing precedence: return_shipping > single_modal >
 *    connect_per_seller > legacy_app > ignore
 *  - settlement outcome: ok -> 200; recovered (allocation write failed but an
 *    order shell with payment_processing=true persists) -> 200 retry-safe;
 *    fatal_error (transport/precondition failure, no shell) -> 500 + DLQ
 */

import { SINGLE_MODAL_FLOW } from '../create-connect-payment/single-payment-builder.ts';

export { SINGLE_MODAL_FLOW };

/** Compact allocation row carried inside the chunked `allocation_json` blob. */
export interface AllocationMetadataRow {
  sellerId: string;
  /** Durable per-seller shipment id. Unique across rows. */
  shipmentId: string;
  /** Product ids belonging to this seller/shipment, sorted before embed. */
  productIds: string[];
  grossCents: number;
  commissionCents: number;
  shippingCents: number;
  seguroCents: number;
  netCents: number;
}

/** Reassembled allocation envelope parsed from Stripe PI metadata. */
export interface ReassembledAllocation {
  rows: AllocationMetadataRow[];
}

/** Top-level totals metadata cross-reconciled with the reassembled rows. */
export interface SingleModalTotalsCents {
  buyerTotal: number;
  gross: number;
  commission: number;
  shipping: number;
  seguro: number;
  release: number;
}

/** Structured settlement input parsed from a single-modal PI for the RPC. */
export interface SingleModalSettlementInput {
  /** Caller (webhook) sets this from the Stripe PI.id before invoking the RPC. */
  stripePaymentIntentId: string;
  buyerId: string;
  addressId: string;
  /** order_id metadata (== order_group_id); becomes orders.id. */
  orderId: string;
  transferGroup: string;
  totalSellers: number;
  amountCents: number;
  rows: AllocationMetadataRow[];
  totalsCents: SingleModalTotalsCents;
}

type MetadataLike = Record<string, string>;

const requiredStr = (meta: MetadataLike, key: string): string => {
  const v = meta[key];
  return typeof v === 'string' ? v : '';
};

const requiredPositiveInt = (meta: MetadataLike, key: string): number => {
  const raw = meta[key];
  if (typeof raw !== 'string' || raw.length === 0) return Number.NaN;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return Number.NaN;
  return n;
};

const requiredNonNegativeInt = (meta: MetadataLike, key: string): number => {
  const raw = meta[key];
  if (typeof raw !== 'string' || raw.length === 0) return Number.NaN;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return Number.NaN;
  return n;
};

/**
 * Reassemble + structurally validate the chunked allocation JSON embedded in
 * Stripe PI metadata. Throws a typed `INVALID_ALLOCATION_METADATA:*` error on
 * any inconsistency. The returned rows are guaranteed to carry non-empty
 * sellerId/shipmentId/productIds, unique shipmentId across rows, non-negative
 * integer cents, and a per-row gross==commission+shipping+net breakdown.
 */
export function reassembleAllocationMetadata(
  metadata: MetadataLike,
): ReassembledAllocation {
  const countRaw = metadata.allocation_chunk_count;
  if (countRaw === undefined) {
    throw new Error('INVALID_ALLOCATION_METADATA:missing_chunk_count');
  }
  const chunkCount = Number(countRaw);
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
    throw new Error('INVALID_ALLOCATION_METADATA:invalid_chunk_count');
  }

  let joined = '';
  for (let i = 0; i < chunkCount; i += 1) {
    const key = `allocation_json_${i}`;
    const piece = metadata[key];
    if (typeof piece !== 'string') {
      throw new Error(`INVALID_ALLOCATION_METADATA:missing_chunk_${i}`);
    }
    joined += piece;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(joined);
  } catch {
    throw new Error('INVALID_ALLOCATION_METADATA:invalid_json');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { rows?: unknown }).rows)
  ) {
    throw new Error('INVALID_ALLOCATION_METADATA:bad_shape');
  }
  const rows = (parsed as { rows: unknown[] }).rows;
  if (rows.length === 0) {
    throw new Error('INVALID_ALLOCATION_METADATA:bad_shape');
  }

  const out: AllocationMetadataRow[] = [];
  const seenShipmentIds = new Set<string>();

  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('INVALID_ALLOCATION_METADATA:bad_shape');
    }
    const r = raw as Record<string, unknown>;
    const sellerId = r.sellerId;
    const shipmentId = r.shipmentId;
    const productIds = r.productIds;
    const grossCents = r.grossCents;
    const commissionCents = r.commissionCents;
    const shippingCents = r.shippingCents;
    const seguroCents = r.seguroCents;
    const netCents = r.netCents;

    if (typeof sellerId !== 'string' || sellerId.length === 0) {
      throw new Error('INVALID_ALLOCATION_METADATA:missing_row_field:sellerId');
    }
    if (typeof shipmentId !== 'string' || shipmentId.length === 0) {
      throw new Error('INVALID_ALLOCATION_METADATA:missing_row_field:shipmentId');
    }
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new Error('INVALID_ALLOCATION_METADATA:missing_row_field:productIds');
    }
    if (!productIds.every((p) => typeof p === 'string' && p.length > 0)) {
      throw new Error('INVALID_ALLOCATION_METADATA:missing_row_field:productIds');
    }
    const cents = [
      ['grossCents', grossCents],
      ['commissionCents', commissionCents],
      ['shippingCents', shippingCents],
      ['seguroCents', seguroCents],
      ['netCents', netCents],
    ] as const;
    for (const [name, v] of cents) {
      if (!Number.isInteger(v) || (v as number) < 0) {
        throw new Error(`INVALID_ALLOCATION_METADATA:missing_row_field:${name}`);
      }
    }
    if (seenShipmentIds.has(shipmentId)) {
      throw new Error('INVALID_ALLOCATION_METADATA:duplicate_shipment_id');
    }
    seenShipmentIds.add(shipmentId);
    if (
      (commissionCents as number) + (shippingCents as number) + (netCents as number) !==
      grossCents
    ) {
      throw new Error('INVALID_ALLOCATION_METADATA:row_breakdown');
    }
    if ((netCents as number) < 0) {
      throw new Error('INVALID_ALLOCATION_METADATA:negative_net');
    }

    out.push({
      sellerId,
      shipmentId,
      productIds: productIds as string[],
      grossCents: grossCents as number,
      commissionCents: commissionCents as number,
      shippingCents: shippingCents as number,
      seguroCents: seguroCents as number,
      netCents: netCents as number,
    });
  }

  return { rows: out };
}

/**
 * Parse a single-modal PI's metadata + amount into a structured settlement
 * input for the webhook's RPC call. Cross-reconciles the top-level totals
 * metadata against the reassembled rows so a corrupt/tampered metadata block
 * is detected before any DB write. Throws `INVALID_SINGLE_MODAL_METADATA:*` on
 * top-level field failures and propagates `INVALID_ALLOCATION_METADATA:*` from
 * the reassembly step.
 */
export function parseSingleModalPayload(intent: {
  metadata: MetadataLike;
  amount: number;
}): SingleModalSettlementInput {
  const meta = intent.metadata;

  const buyerId = requiredStr(meta, 'buyer_id');
  if (buyerId.length === 0) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:missing_buyer_id');
  }
  const addressId = requiredStr(meta, 'address_id');
  if (addressId.length === 0) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:missing_address_id');
  }
  const orderIdRaw = requiredStr(meta, 'order_id');
  const orderGroupId = requiredStr(meta, 'order_group_id');
  const orderId = orderIdRaw.length > 0 ? orderIdRaw : orderGroupId;
  if (orderId.length === 0) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:missing_order_id');
  }
  const transferGroup = requiredStr(meta, 'transfer_group');
  if (transferGroup.length === 0) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:missing_transfer_group');
  }
  const totalSellers = requiredPositiveInt(meta, 'total_sellers');
  if (Number.isNaN(totalSellers)) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:missing_total_sellers');
  }

  const reassembled = reassembleAllocationMetadata(meta);

  let buyerTotal = 0;
  let gross = 0;
  let commission = 0;
  let shipping = 0;
  let seguro = 0;
  let release = 0;
  for (const r of reassembled.rows) {
    buyerTotal += r.grossCents + r.seguroCents;
    gross += r.grossCents;
    commission += r.commissionCents;
    shipping += r.shippingCents;
    seguro += r.seguroCents;
    release += r.netCents;
  }
  const totalsCents: SingleModalTotalsCents = {
    buyerTotal,
    gross,
    commission,
    shipping,
    seguro,
    release,
  };

  const declaredBuyerTotal = requiredNonNegativeInt(meta, 'buyer_total_cents');
  if (Number.isNaN(declaredBuyerTotal)) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:missing_buyer_total_cents');
  }
  if (declaredBuyerTotal !== buyerTotal) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:buyer_total_mismatch');
  }

  if (intent.amount !== buyerTotal) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:amount_mismatch');
  }

  const declaredTotals: Array<[
    key: keyof SingleModalTotalsCents,
    metaKey: string,
  ]> = [
    ['gross', 'total_gross_cents'],
    ['commission', 'total_commission_cents'],
    ['shipping', 'total_shipping_cents'],
    ['seguro', 'total_seguro_cents'],
    ['release', 'total_release_cents'],
  ];

  for (const [key, metaKey] of declaredTotals) {
    const declared = requiredNonNegativeInt(meta, metaKey);
    if (Number.isNaN(declared)) {
      throw new Error(`INVALID_SINGLE_MODAL_METADATA:missing_${metaKey}`);
    }
    if (declared !== totalsCents[key]) {
      throw new Error(`INVALID_SINGLE_MODAL_METADATA:total_${key}_mismatch`);
    }
  }

  if (Number.isInteger(totalSellers) && reassembled.rows.length !== totalSellers) {
    throw new Error('INVALID_SINGLE_MODAL_METADATA:total_sellers_mismatch');
  }

  return {
    stripePaymentIntentId: '',
    buyerId,
    addressId,
    orderId,
    transferGroup,
    totalSellers,
    amountCents: intent.amount,
    rows: reassembled.rows,
    totalsCents,
  };
}

/**
 * Pure webhook routing decision for `payment_intent.succeeded`. Returns a
 * discriminated union describing which legacy/single-modal body `index.ts`
 * should run. Routing precedence:
 *   1. metadata.type === 'return_shipping'  -> return_shipping
 *   2. metadata.flow === SINGLE_MODAL_FLOW  -> single_modal (payload validated)
 *   3. metadata.seller_id present            -> connect_per_seller
 *   4. metadata.app_name === 'selene'       -> legacy_app
 *   5. otherwise                            -> ignore
 *
 * For the single-modal route the payload is parsed/validated HERE so a
 * metadata-corrupt PI never reaches the DB; the webhook maps the thrown
 * `INVALID_*` error to a fatal 500 + DLQ.
 */
export type WebhookAction =
  | { kind: 'return_shipping' }
  | { kind: 'single_modal'; payload: SingleModalSettlementInput }
  | { kind: 'connect_per_seller' }
  | { kind: 'legacy_app' }
  | { kind: 'ignore' };

export function resolvePaymentIntentSucceededAction(intent: {
  metadata: MetadataLike;
  amount: number;
}): WebhookAction {
  const meta = intent.metadata;

  if (meta.type === 'return_shipping') {
    return { kind: 'return_shipping' };
  }

  if (meta.flow === SINGLE_MODAL_FLOW) {
    const payload = parseSingleModalPayload(intent);
    return { kind: 'single_modal', payload };
  }

  if (typeof meta.seller_id === 'string' && meta.seller_id.length > 0) {
    return { kind: 'connect_per_seller' };
  }

  if (meta.app_name === 'selene') {
    return { kind: 'legacy_app' };
  }

  return { kind: 'ignore' };
}

/**
 * Map the settlement RPC result to a webhook HTTP outcome.
 *
 *   - ok: RPC returned success        -> 200 {received:true}
 *   - recovered: RPC returned failure but persisted an order shell with
 *     payment_processing=true (admin-visible recovery) -> 200 retry-safe
 *   - fatal_error: RPC transport threw or returned an unexpected shape. No
 *     order shell persisted -> the webhook throws so the existing catch
 *     records the event in the DLQ and returns 500 (Stripe retries the
 *     webhook, which is idempotent).
 */
export type SettlementOutcome =
  | { kind: 'ok'; body: { received: true } }
  | { kind: 'recovered'; reason: string }
  | { kind: 'fatal_error'; message: string };

export function buildSettlementOutcome(input: {
  rpcResult: unknown;
  rpcError: { message: string } | null;
}): SettlementOutcome {
  const { rpcResult, rpcError } = input;

  if (rpcError) {
    return { kind: 'fatal_error', message: rpcError.message };
  }

  const r = rpcResult as { success?: unknown; error?: unknown } | null;
  if (
    !r ||
    typeof r !== 'object' ||
    typeof r.success !== 'boolean'
  ) {
    return { kind: 'fatal_error', message: 'UNEXPECTED_RPC_RESPONSE' };
  }

  if (r.success === true) {
    return { kind: 'ok', body: { received: true } };
  }

  const reason =
    typeof r.error === 'string'
      ? r.error
      : r.error && typeof (r.error as { message?: unknown }).message === 'string'
        ? (r.error as { message: string }).message
        : 'UNKNOWN_RECOVERY_REASON';

  return { kind: 'recovered', reason };
}
