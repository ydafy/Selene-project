export interface ReturnShippingPaymentIntentInput {
  amountCents: number;
  customerId: string;
  disputeId: string;
  orderId: string;
  sellerId: string;
  shipmentId: string;
  stripeAccountId: string;
}

export function buildReturnShippingPaymentIntentParams(
  input: ReturnShippingPaymentIntentInput,
) {
  return {
    params: {
      amount: input.amountCents,
      currency: 'mxn',
      customer: input.customerId,
      // Cards only, fixed in code instead of the Dashboard configuration (#567):
      // OXXO cannot be refunded through Stripe and bank transfer refunds are
      // asynchronous. The pinned API rejects `payment_method_types`.
      allowed_payment_method_types: ['card'],
      on_behalf_of: input.stripeAccountId,
      metadata: {
        app_name: 'selene',
        type: 'return_shipping',
        purpose: 'return_shipping',
        dispute_id: input.disputeId,
        order_id: input.orderId,
        seller_id: input.sellerId,
        shipment_id: input.shipmentId,
      },
    },
    options: { idempotencyKey: `return_pay_${input.disputeId}` },
  };
}
