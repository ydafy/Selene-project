import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static source guards for the post-SCT "normal orders multi-shipment cleanup".
 *
 * These UI files import React Native / Expo modules that Bun cannot resolve in
 * a pure Node test runner, so we guard the *source* strings (same pattern as
 * `connectMoneyFlowGuards.test.ts` and `publicProfileProductionAudit.test.ts`)
 * instead of importing them. Each guard pins one of the cleanup decisions so a
 * future edit cannot silently regress the shipment-aware behavior.
 */

const FRONTEND = join(import.meta.dir, '..', '..', '..');

const read = (relPath: string) =>
  readFileSync(join(FRONTEND, relPath), 'utf8').replace(/\s+/g, ' ');

describe('orders detail screen shipment-aware source guards', () => {
  const detail = read('app/profile/orders/[id].tsx');

  it('prefers the per-shipment-enriched list from useShipmentsByOrder over raw order.shipments', () => {
    // The migration note used to fall back to order.shipments first; that
    // shipped RAW rows (no isBuyer/isSeller/permissions) and clobbered them
    // with order-level permissions. The cleanup flips the preference.
    expect(detail).toContain('const source = shipments ?? order?.shipments;');
  });

  it('no longer hard-overrides permissions with the order-level object', () => {
    // The stale `permissions: order?.permissions ?? {}` hard override is gone;
    // we only borrow it when the shipment itself has none (transient fallback).
    expect(detail).not.toContain('permissions: order?.permissions ?? {},');
    expect(detail).toContain(
      'permissions: rawShipment.permissions ?? order?.permissions ?? {},',
    );
  });

  it('drives the order stepper from the current shipment status', () => {
    expect(detail).toContain(
      'status={currentShipment?.status ?? order.visualStatus}',
    );
  });

  it('reads tracking permissions from the shipment, not the order', () => {
    expect(detail).toContain('const p = currentShipment.permissions;');
  });

  it('shows the shipment subtotal for multi-shipment orders', () => {
    expect(detail).toContain('const shipmentSubtotal = useMemo(');
    expect(detail).toContain('const isMultiShipment =');
    expect(detail).toContain(
      'const displayedTotal = isMultiShipment ? shipmentSubtotal : (order?.total_amount ?? 0);',
    );
    expect(detail).toContain('formatCurrency(displayedTotal)');
  });

  it('passes the current shipment seller id to the review modal', () => {
    expect(detail).toContain('sellerId={currentShipment?.seller_id}');
  });

  it('gates the generate-label button on the shipment seller, not the order', () => {
    // `order.isSeller` is true if the viewer is the seller of ANY item; in a
    // multi-seller order that would surface the button on another seller's
    // shipment. The gate must read the per-shipment `isSeller`. Source is
    // whitespace-flattened by the read() helper.
    expect(detail).toContain(
      '{currentShipment?.isSeller && currentShipment?.status ===',
    );
    expect(detail).not.toContain('{order.isSeller &&');
  });
});

describe('OrderActionCard shipment-level timing guard', () => {
  const card = read('components/features/orders/OrderActionCard.tsx');

  it('starts the release countdown from the shipment delivered_at, not the order', () => {
    // In multi-seller orders, order.delivered_at is set when the LAST shipment
    // delivers; using it would mis-anchor each seller's 48h window. The
    // cleanup reads shipment.delivered_at instead.
    expect(card).toContain(
      'if (permissions.showSellerDeliveredBanner && shipment.delivered_at)',
    );
    expect(card).toContain("return { startTime: shipment.delivered_at, limit: 48 };");
    expect(card).not.toContain('return { startTime: order.delivered_at');
  });
});

describe('orders index role-aware navigation guard', () => {
  const index = read('app/profile/orders/index.tsx');

  it('delegates navigation to the canonical shipment-aware resolver', () => {
    expect(index).toContain("from './order-view-routing'");
    expect(index).toContain('const view = resolveRoleAwareOrderView(');
    expect(index).toContain('shipments: item.shipments.map((shipment) => ({');
  });
});

describe('ReviewModal shipment-aware seller target guard', () => {
  const modal = read('components/features/profile/ReviewModal.tsx');

  it('accepts an optional sellerId and falls back to the first shipment seller', () => {
    expect(modal).toContain('sellerId?: string;');
    expect(modal).toContain(
      'const reviewSellerId = sellerId || order.shipments[0]?.seller_id ||',
    );
    expect(modal).toContain('sellerId: reviewSellerId');
    expect(modal).not.toContain('order.items[0]?.seller_id');
  });

  it('accepts optional shipmentId and productId and forwards verified-purchase linkage to the mutation', () => {
    // V1 of the follow-up: ReviewModal must thread the shipment-safe identity
    // tuple (reviewer_id, shipment_id, product_id) through useReviewAction so
    // verified-purchase badges never fall back to order-first attribution.
    expect(modal).toContain('shipmentId?: string;');
    expect(modal).toContain('productId?: string;');
    expect(modal).toContain('shipmentId: shipmentId,');
    expect(modal).toContain('productId: productId,');
  });
});

describe('orders detail screen shipment-aware review identity guard', () => {
  const detail = read('app/profile/orders/[id].tsx');

  it('threads the per-shipment id and the active per-product id into ReviewModal', () => {
    // V2 expands reviews to one per product within a shipment. The screen must
    // drive ReviewModal.productId from the per-item button's active state
    // (activeReviewProductId) — NOT from currentShipment?.items?.[0] (V1) and
    // never from order.items[0] (the multi-seller bug).
    expect(detail).toContain('shipmentId={currentShipment?.id}');
    expect(detail).toContain('productId={activeReviewProductId ?? undefined}');
    expect(detail).not.toContain('productId={currentShipment?.items?.[0]');
    expect(detail).not.toContain('productId={order.items[0]');
  });
});

describe('orders detail screen shipment_id param normalization guard', () => {
  const detail = read('app/profile/orders/[id].tsx');

  it('normalizes the shipment_id search param to a scalar before any comparison', () => {
    // Expo Router surfaces `useLocalSearchParams` values as `string | string[]`.
    // Comparing `s.id === shipment_id` when shipment_id is an array is always
    // false and silently falls back to `source[0]` (the PAID shipment), which
    // hides the per-product review button on the COMPLETED shipment. The
    // normalized scalar `shipmentId` must drive the find().
    expect(detail).toContain(
      'const shipmentId = Array.isArray(shipment_id) ? shipment_id[0] : (shipment_id ?? undefined);',
    );
  });

  it('drops the silent ?? source[0] fallback inside the shipment find()', () => {
    // The fallback masked the param mismatch by always returning the first
    // shipment. When a shipment_id is present but no loaded row matches, the
    // screen must NOT invent a shipment — it must short-circuit instead.
    expect(detail).not.toContain('?? source[0])');
    expect(detail).toContain(
      'const rawShipment = shipmentId ? source.find((s) => s.id === shipmentId) : source[0];',
    );
  });

  it('short-circuits the screen when a requested shipment_id is missing from the loaded rows', () => {
    // Without this guard, `rawShipment` would be undefined and downstream
    // `currentShipment` would collapse to null silently; the review gate would
    // fail on an empty status string instead of a clear "not found" state.
    expect(detail).toContain('if (shipmentId && !rawShipment) return null;');
  });

  it('uses the normalized shipmentId in the multi-seller banner visibility gate', () => {
    // The banner must hide when a specific shipment is selected. Reading the
    // raw `shipment_id` array here would keep the banner visible even after
    // the user tapped a shipment, because `!shipment_id` on an array is false.
    expect(detail).toContain('order.shipments.length > 1 && !shipmentId && (');
    expect(detail).not.toContain('!shipment_id && (');
  });
});

describe('useShipmentsByOrder query key hardening guard', () => {
  const hook = read('core/hooks/useShipments.ts');

  it('includes the viewer userId in the useShipmentsByOrder query key', () => {
    // Without userId in the key, a session rehydration between two logged-in
    // users on the same device can serve the previous user's cached shipments
    // and trigger stale enrichment comparisons. The key must scope per user.
    expect(hook).toContain("queryKey: ['shipments', orderId, userId],");
  });
});

describe('orders summary canonical shipment source guard', () => {
  const summary = read('app/profile/orders/summary/[id].tsx');

  it('prefers order.shipments and falls back to the shipments hook', () => {
    // Already canonical before this cleanup; guard that it stays that way and
    // that the summary overview keeps using order-level totals/status (the
    // summary is order-scoped, not shipment-scoped).
    expect(summary).toContain('if (order?.shipments && order.shipments.length > 0)');
    expect(summary).toContain('return shipments ?? [];');
    expect(summary).toContain('formatCurrency(visibleTotal)');
  });
});
