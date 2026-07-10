import { describe, expect, it } from 'bun:test';

import { resolveAutoCancelShipmentCancellationGate } from './auto-cancel-safety';

describe('resolveAutoCancelShipmentCancellationGate', () => {
  it('blocks shipment cancellation when the Stripe payment intent is missing', () => {
    expect(
      resolveAutoCancelShipmentCancellationGate({
        finalStripeIntentId: null,
        refundAmountCents: 125_000,
      }),
    ).toEqual({
      shouldCancelShipment: false,
      level: 'CRITICAL',
      code: 'AUTO_CANCEL_MISSING_PAYMENT_INTENT',
      message:
        'Auto-cancel skipped: missing Stripe payment intent, refusing to cancel shipment without a verified refund.',
    });
  });

  it('blocks shipment cancellation when the refund amount is invalid', () => {
    expect(
      resolveAutoCancelShipmentCancellationGate({
        finalStripeIntentId: 'pi_123',
        refundAmountCents: 0,
      }),
    ).toEqual({
      shouldCancelShipment: false,
      level: 'ERROR',
      code: 'AUTO_CANCEL_INVALID_REFUND_AMOUNT',
      message:
        'Auto-cancel skipped: invalid refund amount, refusing to cancel shipment without a verified refund.',
    });
  });

  it('allows shipment cancellation only after the refund can be attempted safely', () => {
    expect(
      resolveAutoCancelShipmentCancellationGate({
        finalStripeIntentId: 'pi_123',
        refundAmountCents: 125_000,
      }),
    ).toEqual({ shouldCancelShipment: true });
  });
});
