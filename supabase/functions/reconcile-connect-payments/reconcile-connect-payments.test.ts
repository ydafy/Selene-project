import { describe, expect, it } from 'bun:test';

import { shouldReconcilePaymentIntent } from './reconcile-connect-payments';

describe('reconcile-connect-payments helpers', () => {
  it('reconciles succeeded Connect PIs for draft shipments', () => {
    expect(
      shouldReconcilePaymentIntent({
        status: 'succeeded',
        metadata: { seller_id: 'seller-a', order_id: 'order-1', shipment_id: 'ship-1' },
        localShipmentStatus: 'draft',
      }),
    ).toBe(true);
  });

  it('skips legacy or already processed payment intents', () => {
    expect(
      shouldReconcilePaymentIntent({
        status: 'succeeded',
        metadata: { product_ids: '["p1"]' },
        localShipmentStatus: 'draft',
      }),
    ).toBe(false);

    expect(
      shouldReconcilePaymentIntent({
        status: 'succeeded',
        metadata: { seller_id: 'seller-a', order_id: 'order-1', shipment_id: 'ship-1' },
        localShipmentStatus: 'paid',
      }),
    ).toBe(false);
  });
});
