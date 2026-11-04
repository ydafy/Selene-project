import { SellDraft } from '../store/useSellStore';

/**
 * Determines whether the sell draft has user-entered data that should be
 * protected by the exit guard.
 *
 * Selecting a category alone is not considered dirty; entering any field is.
 */
export const isSellDraftDirty = (draft: SellDraft): boolean => {
  if (!draft.category) return false;

  return (
    draft.name !== '' ||
    draft.price !== '' ||
    draft.condition !== '' ||
    draft.usage !== '' ||
    draft.description !== '' ||
    draft.origin_zip !== '' ||
    Object.keys(draft.specifications).length > 0 ||
    draft.images.length > 0
  );
};
