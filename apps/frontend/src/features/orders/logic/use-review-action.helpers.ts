/**
 * Pure builder for the `reviews` insert payload. Extracted from
 * `useReviewAction` so the verified-purchase linkage mapping is testable
 * without mocking TanStack Query / Supabase (see Extract-Before-Mock rule).
 *
 * `reviews.shipment_id` is required, and the insert policy only accepts a
 * review that names a completed shipment of the seller in the buyer's order;
 * `product_id` is nullable and, when sent, must be an item of that shipment.
 * The database keeps one review per `(reviewer_id, shipment_id)`.
 */
export interface ReviewMutationInput {
  orderId: string;
  rating: number;
  comment: string;
  sellerId: string;
  reviewerId: string;
  /** Shipment being reviewed. */
  shipmentId: string;
  /** Product within the shipment being reviewed. `null`/omitted reviews the seller only. */
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
  shipment_id: string;
  product_id: string | null;
} => ({
  order_id: input.orderId,
  seller_id: input.sellerId,
  reviewer_id: input.reviewerId,
  rating: input.rating,
  comment: input.comment,
  shipment_id: input.shipmentId,
  product_id: input.productId ?? null,
});
