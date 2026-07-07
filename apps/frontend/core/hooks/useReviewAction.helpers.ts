/**
 * Pure builder for the `reviews` insert payload. Extracted from
 * `useReviewAction` so the verified-purchase linkage mapping is testable
 * without mocking TanStack Query / Supabase (see Extract-Before-Mock rule).
 *
 * The `reviews` table columns `shipment_id` and `product_id` are nullable
 * (see `packages/types/src/database.types.ts`). For V1 we write explicit
 * `null` when the caller cannot prove shipment-product linkage, so legacy
 * rows stay distinguishable from verified-purchase rows in the
 * `(reviewer_id, shipment_id, product_id)` identity contract.
 */
export interface ReviewMutationInput {
  orderId: string;
  rating: number;
  comment: string;
  sellerId: string;
  reviewerId: string;
  /** Shipment being reviewed. `null`/omitted for legacy order-first reviews. */
  shipmentId?: string | null;
  /** Product within the shipment being reviewed. `null`/omitted for legacy. */
  productId?: string | null;
}

export const buildReviewInsertPayload = (
  input: ReviewMutationInput,
): {
  order_id: string;
  seller_id: string;
  reviewer_id: string;
  rating: number;
  comment: string;
  shipment_id: string | null;
  product_id: string | null;
} => ({
  order_id: input.orderId,
  seller_id: input.sellerId,
  reviewer_id: input.reviewerId,
  rating: input.rating,
  comment: input.comment,
  shipment_id: input.shipmentId ?? null,
  product_id: input.productId ?? null,
});