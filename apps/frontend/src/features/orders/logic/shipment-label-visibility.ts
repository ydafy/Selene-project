// The label is live from creation until the package is with the carrier. A
// cancelled shipment (for example a preparing timeout) has its label cancelled
// at the carrier, so showing it would let the seller print a dead label.
const LIVE_LABEL_STATUSES = ['paid', 'preparing', 'shipped'];

export function canShowSellerLabelActions({
  isSeller,
  status,
  labelUrl,
}: {
  isSeller: boolean;
  status: string;
  labelUrl: string | null | undefined;
}): boolean {
  return isSeller && Boolean(labelUrl) && LIVE_LABEL_STATUSES.includes(status);
}
