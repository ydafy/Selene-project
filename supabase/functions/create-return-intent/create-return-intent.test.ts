import { describe, expect, it } from 'bun:test';

import { buildReturnShippingPaymentIntentParams } from './create-return-intent';

describe('create-return-intent helpers', () => {
  it('builds a Connect return-shipping PaymentIntent without legacy payment method pinning', () => {
    const { params, options } = buildReturnShippingPaymentIntentParams({
      amountCents: 30_000,
      customerId: 'cus_seller',
      disputeId: 'dispute-1',
      orderId: 'order-1',
      sellerId: 'seller-1',
      shipmentId: 'shipment-1',
      stripeAccountId: 'acct_seller',
    });

    expect(params).toEqual({
      amount: 30_000,
      currency: 'mxn',
      customer: 'cus_seller',
      automatic_payment_methods: { enabled: true },
      on_behalf_of: 'acct_seller',
      metadata: {
        app_name: 'selene',
        type: 'return_shipping',
        purpose: 'return_shipping',
        dispute_id: 'dispute-1',
        order_id: 'order-1',
        seller_id: 'seller-1',
        shipment_id: 'shipment-1',
      },
    });
    expect(params).not.toHaveProperty('payment_method_types');
    expect(options).toEqual({ idempotencyKey: 'return_pay_dispute-1' });
  });
});
