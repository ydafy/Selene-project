export type PurchaseDialogVariant =
  'pending_verification' | 'in_review' | 'SELLER_NOT_READY';

export type PurchaseGateDecision =
  'add' | PurchaseDialogVariant | 'unavailable';

/**
 * Decides what pressing "add to cart" does from the fresh product status.
 * `sellerBlocked` comes from `isSellerBlocked` (only an explicit false blocks,
 * so unknown readiness adds and the server stays the final gate).
 */
export const decidePurchaseGate = (
  status: string,
  sellerBlocked: boolean,
): PurchaseGateDecision => {
  if (status === 'pending_verification' || status === 'in_review') {
    return status;
  }
  if (status !== 'verified') return 'unavailable';
  return sellerBlocked ? 'SELLER_NOT_READY' : 'add';
};

export type PurchaseDialogContent = {
  titleKey: string;
  lineKey: string;
  favoriteLineKey: string;
  /** Zero-based index in published -> verifying -> ready to buy. */
  currentStep: number;
};

const DIALOG_CONTENT: Record<
  PurchaseDialogVariant,
  Omit<PurchaseDialogContent, 'favoriteLineKey'>
> = {
  pending_verification: {
    titleKey: 'dialogs.pendingTitle',
    lineKey: 'dialogs.pendingLine',
    currentStep: 1,
  },
  in_review: {
    titleKey: 'dialogs.inReviewTitle',
    lineKey: 'dialogs.inReviewLine',
    currentStep: 1,
  },
  SELLER_NOT_READY: {
    titleKey: 'dialogs.sellerNotReadyTitle',
    lineKey: 'dialogs.sellerNotReadyLine',
    currentStep: 2,
  },
};

/** i18n keys and progress step the purchase dialog shows for a variant. */
export const purchaseDialogContent = (
  variant: PurchaseDialogVariant,
  isFavorite: boolean,
): PurchaseDialogContent => ({
  ...DIALOG_CONTENT[variant],
  favoriteLineKey: isFavorite
    ? 'dialogs.favoriteKnown'
    : 'dialogs.favoritePrompt',
});
