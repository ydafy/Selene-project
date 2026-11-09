export type AutoCancelShipmentCancellationGateResult =
  | {
      shouldCancelShipment: true;
    }
  | {
      shouldCancelShipment: false;
      level: 'ERROR' | 'CRITICAL';
      code:
        | 'AUTO_CANCEL_MISSING_PAYMENT_INTENT'
        | 'AUTO_CANCEL_INVALID_REFUND_AMOUNT';
      message: string;
    };

export function resolveAutoCancelShipmentCancellationGate(input: {
  finalStripeIntentId: string | null;
  refundAmountCents: number;
}): AutoCancelShipmentCancellationGateResult {
  if (!input.finalStripeIntentId) {
    return {
      shouldCancelShipment: false,
      level: 'CRITICAL',
      code: 'AUTO_CANCEL_MISSING_PAYMENT_INTENT',
      message:
        'Auto-cancel skipped: missing Stripe payment intent, refusing to cancel shipment without a verified refund.',
    };
  }

  if (
    !Number.isInteger(input.refundAmountCents) ||
    input.refundAmountCents <= 0
  ) {
    return {
      shouldCancelShipment: false,
      level: 'ERROR',
      code: 'AUTO_CANCEL_INVALID_REFUND_AMOUNT',
      message:
        'Auto-cancel skipped: invalid refund amount, refusing to cancel shipment without a verified refund.',
    };
  }

  return { shouldCancelShipment: true };
}
