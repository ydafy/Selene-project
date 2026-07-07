export interface ParsedProductIdsMetadata {
  productIds: string[];
  malformed: boolean;
}

export interface ConnectRollbackRefundParams {
  payment_intent: string;
  reason: 'requested_by_customer';
  reverse_transfer: true;
  metadata: {
    order_id: string;
    rollback_reason: 'partial_connect_checkout_failure';
  };
}

/**
 * Parse the legacy top-level `product_ids` metadata value (a JSON-string array
 * of product ids). Returns `malformed: true` (without throwing) when the value
 * is present but not a JSON array of non-empty strings, so the rollback can
 * still attempt release with whatever ids it could read.
 */
export function parseProductIdsMetadata(
  productIdsMetadata: string | undefined,
): ParsedProductIdsMetadata {
  if (!productIdsMetadata) {
    return { productIds: [], malformed: false };
  }

  try {
    const parsed: unknown = JSON.parse(productIdsMetadata);
    if (!Array.isArray(parsed)) {
      return { productIds: [], malformed: true };
    }

    const stringProductIds: string[] = [];
    let malformed = false;

    for (const productId of parsed) {
      if (typeof productId === 'string' && productId.trim().length > 0) {
        stringProductIds.push(productId);
      } else {
        malformed = true;
      }
    }

    const productIds = Array.from(new Set(stringProductIds));

    return {
      productIds,
      malformed,
    };
  } catch {
    return { productIds: [], malformed: true };
  }
}

/**
 * Best-effort reassembly of single-modal allocation metadata chunks
 * (`allocation_chunk_count` + `allocation_json_N`) written by the
 * `create-connect-payment/single-payment-builder.ts` Phase 3 path. The
 * single-modal checkout intentionally does NOT emit a top-level `product_ids`
 * metadata key (it would exceed Stripe's 500-char per-value limit for many
 * products), so the rollback must read product ids from the chunked allocation
 * blob instead.
 *
 * Unlike the strict webhook reassembler (which throws on any inconsistency to
 * keep corrupt metadata OUT of DB writes), this rollback helper is TOLERANT:
 * it returns whatever product ids it can extract so the rollback can release
 * as many RESERVED products as possible. On any inconsistency it returns
 * `{ productIds: [], malformed: true }` without throwing — the caller logs a
 * warning and continues (legacy `product_ids` may still yield ids).
 *
 * Returns `malformed: false` (with empty ids) when the metadata carries no
 * `allocation_chunk_count`, i.e. it is not a single-modal intent — so legacy
 * intents are unaffected.
 */
export function parseAllocationProductIds(
  metadata: Record<string, string | undefined>,
): ParsedProductIdsMetadata {
  const countRaw = metadata.allocation_chunk_count;
  if (typeof countRaw !== 'string' || countRaw.length === 0) {
    return { productIds: [], malformed: false };
  }

  const chunkCount = Number(countRaw);
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
    return { productIds: [], malformed: true };
  }

  let joined = '';
  for (let i = 0; i < chunkCount; i += 1) {
    const piece = metadata[`allocation_json_${i}`];
    if (typeof piece !== 'string') {
      return { productIds: [], malformed: true };
    }
    joined += piece;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(joined);
  } catch {
    return { productIds: [], malformed: true };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { rows?: unknown }).rows)
  ) {
    return { productIds: [], malformed: true };
  }

  const rows = (parsed as { rows: unknown[] }).rows;
  const productIds: string[] = [];
  let malformed = false;

  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) {
      malformed = true;
      continue;
    }
    const row = raw as Record<string, unknown>;
    const ids = row.productIds;
    if (!Array.isArray(ids)) {
      malformed = true;
      continue;
    }
    for (const id of ids) {
      if (typeof id === 'string' && id.trim().length > 0) {
        productIds.push(id);
      } else {
        malformed = true;
      }
    }
  }

  return { productIds: Array.from(new Set(productIds)), malformed };
}

/**
 * Extract product ids to release from a PaymentIntent's metadata, supporting
 * BOTH metadata shapes the checkout can write:
 *   1. Legacy per-seller connect: a top-level `product_ids` JSON-string array.
 *   2. Phase 3 single-modal multi-seller: chunked `allocation_json_*` carrying
 *      per-shipment `productIds` rows (no top-level `product_ids`).
 *
 * Returns the de-duplicated union of both sources so the rollback releases
 * every reserved product regardless of which checkout flow produced the intent.
 * `malformed` is true if EITHER source was present but unreadable, so the
 * caller can warn without skipping release of the ids it did parse.
 */
export function extractProductIdsFromIntentMetadata(
  metadata: Record<string, string | undefined> | undefined,
): ParsedProductIdsMetadata {
  if (!metadata) {
    return { productIds: [], malformed: false };
  }

  const legacy = parseProductIdsMetadata(metadata.product_ids);
  const allocation = parseAllocationProductIds(metadata);

  const merged = Array.from(
    new Set([...legacy.productIds, ...allocation.productIds]),
  );

  return {
    productIds: merged,
    malformed: legacy.malformed || allocation.malformed,
  };
}

export function mergeUniqueProductIds(
  currentProductIds: string[],
  nextProductIds: string[],
): string[] {
  return Array.from(new Set([...currentProductIds, ...nextProductIds]));
}

export function buildConnectRollbackRefundParams({
  paymentIntentId,
  orderId,
}: {
  paymentIntentId: string;
  orderId: string;
}): ConnectRollbackRefundParams {
  return {
    payment_intent: paymentIntentId,
    reason: 'requested_by_customer',
    reverse_transfer: true,
    metadata: {
      order_id: orderId,
      rollback_reason: 'partial_connect_checkout_failure',
    },
  };
}
