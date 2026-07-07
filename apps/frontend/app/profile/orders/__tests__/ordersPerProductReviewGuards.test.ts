import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * V2 per-product review source guards.
 *
 * The React Native detail screen imports modules Bun cannot resolve in a pure
 * Node runner, so — matching the established pattern in
 * `ordersMultiShipmentGuards.test.ts` and `publicProfileProductionAudit.test.ts`
 * — we guard the *source* strings. Each guard pins one V2 decision so a future
 * edit cannot silently regress the per-product review behavior.
 */

const FRONTEND = join(import.meta.dir, '..', '..', '..', '..');

const read = (relPath: string) =>
  readFileSync(join(FRONTEND, relPath), 'utf8').replace(/\s+/g, ' ');

describe('useOrderById review select — V2 product/shipment linkage columns', () => {
  const hook = read('core/hooks/useOrders.ts');

  it('selects product_id, shipment_id and seller_id from the review relation', () => {
    // The pipe (ReviewModal + useReviewAction) already writes these columns;
    // the query must select them so the screen can gate per product_id and
    // surface the seller without an extra round-trip.
    expect(hook).toContain(
      'review:reviews(id, rating, comment, created_at, product_id, shipment_id, seller_id)',
    );
  });

  it('keeps the my-purchases review select aligned with the per-product identity contract', () => {
    // useMyPurchases feeds the orders list; the same linkage columns are
    // required there so the list view can derive the same gate consistently.
    expect(hook).toContain(
      'review:reviews(id, rating, comment, created_at, product_id, shipment_id, seller_id)',
    );
  });
});

describe('orders detail screen V2 per-product review guards', () => {
  const detail = read('app/profile/orders/[id].tsx');

  it('declares ReviewData with the per-product linkage columns', () => {
    // The auxiliary type must carry product_id / shipment_id so the gate can
    // match reviews by product_id instead of by array length.
    expect(detail).toContain('product_id: string | null;');
    expect(detail).toContain('shipment_id: string | null;');
    expect(detail).toContain('seller_id: string;');
  });

  it('imports the pure canReviewProduct gate', () => {
    expect(detail).toContain("from './canReviewProduct'");
  });

  it('replaces the V1 single boolean canReview with the per-product gate', () => {
    // V1 `canReview = ... && !reviewData?.length` hid the button for every
    // product once any review landed. V2 must NOT keep that boolean.
    expect(detail).not.toContain('!reviewData?.length');
    expect(detail).toContain('const canReviewProductFn = useCallback(');
  });

  it('gates review on shipment status (completed), not order status (multi-seller timing)', () => {
    // V2 gate: shipment must be `completed`, not just `delivered`
    // (post-delivery disputes block the gate). Order-level status is ignored.
    expect(detail).toContain('shipmentStatus: currentShipment?.status ??');
    expect(detail).not.toContain('status: order.status');
  });

  it('renders a per-item review affordance inside the shipment items loop', () => {
    expect(detail).toContain('canReviewProductFn(item.product_id)');
    expect(detail).toContain('openReviewFor(item.product_id)');
    expect(detail).toContain('activeReviewProductId');
  });

  it('passes the active product id (state) to ReviewModal instead of the first shipment item', () => {
    // The hard constraint: no `order.items[0]` fallback and no
    // `currentShipment?.items?.[0]?.product_id` V1 scoping.
    expect(detail).toContain('productId={activeReviewProductId ?? undefined}');
    expect(detail).not.toContain('productId={currentShipment?.items?.[0]');
    expect(detail).not.toContain('order.items[0]');
  });

  it('removes the V1 global review section that keyed off reviewData length', () => {
    // The global `reviewData && reviewData.length > 0 ? <ReviewCard .../>`
    // branch is gone; reviews surface per-product instead.
    expect(detail).not.toContain(
      'reviewData && reviewData.length > 0 ?',
    );
    expect(detail).not.toContain(
      'reviewData[0].rating',
    );
  });
});

describe('ReviewModal V2 product-name polish guard', () => {
  const modal = read('components/features/profile/ReviewModal.tsx');

  it('accepts an optional productName prop and renders it under the subtitle when provided', () => {
    expect(modal).toContain('productName?: string;');
    expect(modal).toContain('productName && (');
  });
});