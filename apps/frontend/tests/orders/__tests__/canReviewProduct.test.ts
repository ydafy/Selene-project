import { describe, expect, test } from 'bun:test';

import { canReviewProduct } from '../canReviewProduct';

/**
 * V2 per-product review gating.
 *
 * V1 shipped ONE review per order. V2 lets the buyer review each product
 * once, scoped by `product_id` and gated on `shipment.status === 'completed'`
 * (not order-level, and not just `delivered` — a post-delivery dispute keeps
 * the shipment non-completed).
 */
describe('canReviewProduct', () => {
  const completedShipmentCtx = {
    shipmentStatus: 'completed',
    isBuyer: true,
    reviews: [] as Array<{ product_id: string | null }>,
  };

  test('blocks review when the shipment is not completed', () => {
    expect(
      canReviewProduct('product-1', {
        ...completedShipmentCtx,
        shipmentStatus: 'delivered',
      }),
    ).toBe(false);
  });

  test('blocks review when the viewer is not the buyer', () => {
    expect(
      canReviewProduct('product-1', {
        ...completedShipmentCtx,
        isBuyer: false,
      }),
    ).toBe(false);
  });

  test('allows review for a completed shipment buyer when no review exists for that product', () => {
    expect(canReviewProduct('product-1', completedShipmentCtx)).toBe(true);
  });

  test('blocks review for a product that already has a review with matching product_id', () => {
    expect(
      canReviewProduct('product-1', {
        ...completedShipmentCtx,
        reviews: [{ product_id: 'product-1' }],
      }),
    ).toBe(false);
  });

  test('still allows product A when a review exists only for product B (multi-product shipment core case)', () => {
    expect(
      canReviewProduct('product-A', {
        ...completedShipmentCtx,
        reviews: [{ product_id: 'product-B' }],
      }),
    ).toBe(true);
  });

  test('ignores reviews whose product_id is null (legacy order-first rows)', () => {
    expect(
      canReviewProduct('product-1', {
        ...completedShipmentCtx,
        reviews: [{ product_id: null }],
      }),
    ).toBe(true);
  });
});
