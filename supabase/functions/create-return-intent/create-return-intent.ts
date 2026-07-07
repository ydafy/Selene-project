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
      automatic_payment_methods: { enabled: true },
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
