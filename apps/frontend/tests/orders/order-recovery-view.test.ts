import { describe, expect, it } from 'bun:test';

import {
  resolveBuyerCheckoutRecoveryView,
  shouldSuppressShipmentActionsForBuyerRecovery,
} from '../../app/profile/orders/order-recovery-view';

describe('resolveBuyerCheckoutRecoveryView', () => {
  it('shows pending recovery only to the buyer while compensation is incomplete', () => {
    expect(
      resolveBuyerCheckoutRecoveryView({
        isBuyer: true,
        paymentProcessing: true,
        compensationState: 'refund_failed_retry_queued',
        orderStatus: 'pending',
      }),
    ).toEqual({ kind: 'pending_refund' });
  });

  it('shows a confirmed refund after finalization and hides recovery UI from sellers', () => {
    expect(
      resolveBuyerCheckoutRecoveryView({
        isBuyer: true,
        paymentProcessing: false,
        compensationState: 'refunded',
        orderStatus: 'refunded',
      }),
    ).toEqual({ kind: 'refunded' });

    expect(
      resolveBuyerCheckoutRecoveryView({
        isBuyer: false,
        paymentProcessing: true,
        compensationState: 'refund_pending',
        orderStatus: 'pending',
      }),
    ).toEqual({ kind: 'none' });
  });

  it('does not present a transient processing failure as a buyer refund and suppresses actions for recovery states', () => {
    const transient = resolveBuyerCheckoutRecoveryView({
      isBuyer: true,
      paymentProcessing: true,
      compensationState: null,
      orderStatus: 'pending',
    });

    expect(transient).toEqual({ kind: 'none' });
    expect(shouldSuppressShipmentActionsForBuyerRecovery({ kind: 'pending_refund' })).toBe(
      true,
    );
    expect(shouldSuppressShipmentActionsForBuyerRecovery({ kind: 'refunded' })).toBe(true);
    expect(shouldSuppressShipmentActionsForBuyerRecovery(transient)).toBe(false);
  });
});
