import type { Tables } from '@selene/types';

export interface SellerReviewRow {
  id: string;
  created_at: string;
  rating: number;
  comment: string | null;
  shipment_id: string | null;
  product_id: string | null;
  reviewer: (Pick<Tables<'profiles'>, 'username' | 'avatar_url'> &
    Partial<Pick<Tables<'profiles'>, 'deleted_at'>>) | null;
  product: {
    name: string;
  } | null;
}

export interface SellerReview extends SellerReviewRow {
  isVerifiedPurchase: boolean;
}

export const hasRenderableReviewComment = (comment: string | null) =>
  typeof comment === 'string' && comment.trim().length > 0;

export const normalizeSellerReviewRows = (
  rows: SellerReviewRow[],
): SellerReview[] => {
  return rows
    .map((row) => ({
      ...row,
      comment: row.comment,
      isVerifiedPurchase: Boolean(row.shipment_id && row.product_id),
    }))
    .filter((review) => hasRenderableReviewComment(review.comment));
};
