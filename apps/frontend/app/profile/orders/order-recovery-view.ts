export type BuyerCheckoutRecoveryView =
  | { kind: 'none' }
  | { kind: 'pending_refund' }
  | { kind: 'refunded' };

export function resolveBuyerCheckoutRecoveryView(input: {
  isBuyer: boolean;
  paymentProcessing: boolean | null | undefined;
  compensationState: string | null | undefined;
  orderStatus: string | null | undefined;
}): BuyerCheckoutRecoveryView {
  if (!input.isBuyer) return { kind: 'none' };

  if (
    input.compensationState === 'refunded' ||
    input.orderStatus === 'refunded'
  ) {
    return { kind: 'refunded' };
  }

  if (
    input.paymentProcessing &&
    (input.compensationState === 'refund_pending' ||
      input.compensationState === 'refunding' ||
      input.compensationState === 'refund_failed_retry_queued')
  ) {
    return { kind: 'pending_refund' };
  }

  return { kind: 'none' };
}

export function shouldSuppressShipmentActionsForBuyerRecovery(
  view: BuyerCheckoutRecoveryView,
): boolean {
  return view.kind === 'pending_refund' || view.kind === 'refunded';
}
