import { ProductCategory, ProductWithSeller, Profile } from '@selene/types';

import { SellDraft } from '../store/useSellStore';

/**
 * Subset of seller fields needed to render the preview card.
 * Keeps the builder decoupled from the full auth context shape.
 */
export type PreviewSellerInfo = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  is_verified_seller: boolean;
  created_at: string;
  updated_at: string | null;
};

/**
 * Builds the mock ProductWithSeller used by the sell preview screen.
 * Extracted to a pure function so it can be memoized by the component.
 */
export const buildPreviewProduct = (
  draft: SellDraft,
  seller: PreviewSellerInfo,
): ProductWithSeller => ({
  // Draft data
  id: draft.id || 'preview_mode',
  name: draft.name,
  description: draft.description,
  price: Number(draft.price),
  category: draft.category as ProductCategory,
  condition: draft.condition,
  usage: draft.usage,
  images: draft.images,
  specifications: draft.specifications,

  // DB metadata mocks
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  status: 'PENDING_VERIFICATION',
  seller_id: seller.id,
  views: 0,
  aspect_ratio: 1,
  deleted_at: null,
  fts: null,
  locked_at: null,
  locked_by: null,
  origin_zip: draft.origin_zip || '',
  package_preset: draft.package_preset || '',
  rejection_reason: null,
  reserved_at: null,
  shipping_cost: Number(draft.shipping_cost || 0),
  shipping_payer: draft.shipping_payer || 'buyer',
  verification_data: null,
  verified_at: null,

  // Seller mock required by ProductWithSeller
  seller: seller as Profile,
});
