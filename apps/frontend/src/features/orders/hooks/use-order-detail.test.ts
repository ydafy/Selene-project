import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const hook = readFileSync(`${import.meta.dir}/use-order-detail.ts`, 'utf8')
  .replace(/\s+/g, ' ')
  .replace(/\( /g, '(')
  .replace(/ \)/g, ')')
  .replace(/,\)/g, ')');

describe('useOrderDetail data wiring', () => {
  it('loads the order, its shipments and the actions for the route id', () => {
    expect(hook).toContain('} = useOrderById(id);');
    expect(hook).toContain('} = useShipmentsByOrder(id);');
    expect(hook).toContain('const actions = useOrderActions(id as string);');
    expect(hook).toContain(
      'const isLoading = isOrderLoading || isShipmentsLoading;',
    );
  });

  it('refreshes the order and its shipments together', () => {
    expect(hook).toContain(
      'const handleRefresh = async () => { await Promise.all([refetchOrder(), refetchShipments()]); };',
    );
  });

  it('routes from the enriched shipments, falling back to the order rows', () => {
    expect(hook).toContain(
      'shipments: (shipments ?? order.shipments).map((shipment) => ({',
    );
    expect(hook).toContain(
      '[order, session?.user.id, shipmentId, shipments]);',
    );
    expect(hook).toContain(
      "if (!isLoading && !shipmentId && orderView && orderView.kind !== 'unavailable') {",
    );
    expect(hook).toContain(
      'router.replace(orderView.href as any); } }, [isLoading, orderView, router, shipmentId]);',
    );
  });

  it('memoizes the current shipment on the order, shipments and addressed id', () => {
    expect(hook).toContain(
      '} as EnrichedShipment; }, [order, shipments, shipmentId]);',
    );
    expect(hook).toContain(
      'const trackingUrl = useShipmentTrackingUrl(currentShipment?.id);',
    );
    expect(hook).toContain(
      "const returnPayment = useReturnPayment(currentShipment?.dispute?.id ?? '');",
    );
  });

  it('picks the return or original tracking number by shipment permission', () => {
    expect(hook).toContain(
      'if (p?.showReturnTracking) return currentShipment.dispute?.return_tracking_number ?? null;',
    );
    expect(hook).toContain(
      'if (p?.showOriginalTracking) return currentShipment.tracking_number; return null; }, [currentShipment]);',
    );
  });

  it('sums price_at_purchase over the shipment items', () => {
    expect(hook).toContain(
      'return currentShipment.items.reduce((sum, i) => sum + Number(i.price_at_purchase ?? 0), 0); }, [currentShipment]);',
    );
  });
});

describe('useOrderDetail review gate', () => {
  it('defaults the review list to an empty array while the order loads', () => {
    expect(hook).toContain(
      'if (!order) return []; return (order as OrderWithReview).review ?? []; }, [order]);',
    );
  });

  it('blocks reviews until the order loads and gates on shipment status, buyer and reviews', () => {
    expect(hook).toContain(
      "(productId: string) => { if (!order) return false; const ctx: CanReviewProductContext = { shipmentStatus: currentShipment?.status ?? '', isBuyer: order.isBuyer, reviews: reviewData, }; return canReviewProduct(productId, ctx); }, [currentShipment?.status, order?.isBuyer, reviewData]);",
    );
  });

  it('opens the review modal for the tapped product', () => {
    expect(hook).toContain(
      'const openReviewFor = useCallback((productId: string) => { setActiveReviewProductId(productId); reviewModalRef.current?.present(); }, []);',
    );
  });
});
