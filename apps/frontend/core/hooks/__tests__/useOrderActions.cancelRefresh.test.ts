import { describe, expect, it } from 'bun:test';

import {
  getCancelOrderFailureInvalidationKeys,
  getCancelOrderSuccessInvalidationKeys,
} from '../useOrderActions.logic';

const ORDER_ID = 'order-1';

describe('cancel-order success refresh', () => {
  const keys = getCancelOrderSuccessInvalidationKeys(ORDER_ID);

  it('keeps the order, purchases, sales and shipments refresh', () => {
    expect(keys).toContainEqual(['order', ORDER_ID]);
    expect(keys).toContainEqual(['my-purchases']);
    expect(keys).toContainEqual(['my-sales']);
    expect(keys).toContainEqual(['shipments', ORDER_ID]);
  });

  it('refreshes listings and products, which fn_cancel_shipment returns to VERIFIED', () => {
    expect(keys).toContainEqual(['my-listings']);
    // useProduct keys its cache ['product', id, userId]; the prefix covers it.
    expect(keys).toContainEqual(['product']);
    expect(keys).toContainEqual(['shipment-cancellation-summary']);
  });
});

describe('cancel-order failure refresh', () => {
  it('refreshes the real state when the state changed or is in progress', () => {
    for (const code of [
      'SHIPMENT_NOT_CANCELABLE',
      'CANCELLATION_BUSY',
      'CANCELLATION_REFUND_UNCONFIRMED',
      'CANCELLATION_ESCALATION_FAILED',
      'CANCELLATION_RECOVERY_REQUIRED',
      'Dinero devuelto pero no se actualizó el envío',
    ]) {
      const keys = getCancelOrderFailureInvalidationKeys(ORDER_ID, new Error(code));
      expect(keys).toContainEqual(['order', ORDER_ID]);
      expect(keys).toContainEqual(['shipments', ORDER_ID]);
      expect(keys).toContainEqual(['my-purchases']);
    }
  });

  it('does not refresh for failures that changed nothing', () => {
    for (const code of ['MAINTENANCE_MODE', 'AUTH_REQUIRED', 'BUYER_ONLY', 'SOMETHING_NEW']) {
      expect(getCancelOrderFailureInvalidationKeys(ORDER_ID, new Error(code))).toEqual([]);
    }
  });
});
