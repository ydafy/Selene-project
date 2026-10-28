// Copy selection for the cancelled-shipment banner. Unknown or missing values
// fall back to the original banner text, so the screen never shows a guess.
export interface ShipmentCancellationSummary {
  source: string;
  refundState: string;
}

export interface CancelledShipmentCopy {
  reasonKey: string | null;
  messageKey: string;
  labelNoticeKey: string | null;
}

const PREFIX = 'orders:actionCard.';

const BUYER_REASON: Record<string, string> = {
  buyer: 'cancelReasonBuyerByBuyer',
  seller: 'cancelReasonBuyerBySeller',
  paid_timeout: 'cancelReasonBuyerPaidTimeout',
  preparing_timeout: 'cancelReasonBuyerPreparingTimeout',
};

const SELLER_REASON: Record<string, string> = {
  buyer: 'cancelReasonSellerByBuyer',
  seller: 'cancelReasonSellerBySeller',
  paid_timeout: 'cancelReasonSellerPaidTimeout',
  preparing_timeout: 'cancelReasonSellerPreparingTimeout',
};

const BUYER_REFUND: Record<string, string> = {
  processing: 'cancelledRefundProcessing',
  refunded: 'cancelledRefundIssued',
  delayed: 'cancelledRefundDelayed',
};

const own = (map: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(map, key) ? map[key] : undefined;

export function resolveCancelledShipmentCopy(
  summary: ShipmentCancellationSummary | null,
  isBuyer: boolean,
  hadLabel = false,
): CancelledShipmentCopy {
  const reason = summary
    ? own(isBuyer ? BUYER_REASON : SELLER_REASON, summary.source)
    : undefined;
  const refund = summary && isBuyer ? own(BUYER_REFUND, summary.refundState) : undefined;

  return {
    reasonKey: reason ? `${PREFIX}${reason}` : null,
    messageKey: `${PREFIX}${refund ?? (isBuyer ? 'cancelledBuyer' : 'cancelledSeller')}`,
    labelNoticeKey: !isBuyer && hadLabel ? `${PREFIX}cancelledLabelInvalidSeller` : null,
  };
}
