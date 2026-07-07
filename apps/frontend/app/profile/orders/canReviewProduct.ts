/**
 * @file app/profile/orders/canReviewProduct.ts
 * @description Pure gate for the V2 per-product review button.
 *
 * V1 shipped ONE review per order: `canReview = completed && isBuyer &&
 * !reviewData?.length` — once any review landed, the button vanished for
 * every other product in a multi-product shipment. V2 scopes the gate by
 * `product_id` so each product in a shipment can be reviewed independently.
 *
 * Extracted as a pure function so the gating logic is testable without
 * rendering the React Native screen (see Extract-Before-Mock rule). The
 * screen is a thin caller: it builds the context from `order`/`review` and
 * delegates the decision here.
 */

export interface ReviewRow {
  /** Nullable on legacy order-first reviews (V0 rows). */
  product_id: string | null;
}

export interface CanReviewProductContext {
  /**
   * Shipment status of the shipment that contains this product
   * (`currentShipment.status`). The product becomes reviewable when its
   * shipment reaches `completed` (delivered + no open disputes), NOT when
   * the whole order is completed. In multi-seller orders one shipment
   * may complete weeks before another, and `delivered` alone is
   * insufficient because a dispute may still be open.
   */
  shipmentStatus: string;
  /** Whether the viewer is the buyer of the order (`order.isBuyer`). */
  isBuyer: boolean;
  /** Existing review rows for the order (`order.review`). */
  reviews: ReviewRow[];
}

/**
 * Returns true when the buyer may still submit a review for `productId`.
 *
 * Rules:
 *  - The product's shipment must be `completed` and the viewer must be the
 *    buyer. Order-level status is NOT used — per-shipment gate allows each
 *    product to be reviewed as soon as its own shipment completes. `delivered`
 *    alone is not enough; a post-delivery dispute blocks the gate via the
 *    shipment staying in a non-completed state.
 *  - No existing review may match `productId` (case-sensitive exact match).
 *  - Legacy reviews with `product_id === null` do NOT suppress per-product
 *    buttons; they predate the per-product identity contract.
 */
export const canReviewProduct = (
  productId: string,
  ctx: CanReviewProductContext,
): boolean => {
  if (ctx.shipmentStatus !== 'completed' || !ctx.isBuyer) return false;
  return !ctx.reviews.some((r) => r.product_id === productId);
};