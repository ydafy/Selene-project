import type { SellerReview } from '../../../core/hooks/useSellerReviews.helpers';

type ReviewCardPresentation = {
  shouldRender: boolean;
  showVerifiedBadge: boolean;
  formattedDate: string;
  accessibilityLabel: string;
};

export type UserReviewCardAccessibilityCopy = {
  userFallback: string;
  itemFallback: string;
  noComment: string;
  reviewFrom: string;
  rating: string;
  outOfFive: string;
  reviewedOn: string;
  comment: string;
  verifiedPurchase: string;
};

const defaultAccessibilityCopy: UserReviewCardAccessibilityCopy = {
  userFallback: 'User',
  itemFallback: 'Item',
  noComment: 'No comment.',
  reviewFrom: 'Review from',
  rating: 'Rating',
  outOfFive: 'out of 5',
  reviewedOn: 'Reviewed on',
  comment: 'Comment',
  verifiedPurchase: 'Verified purchase',
};

const formatReviewDate = (createdAt: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(createdAt));

export const getUserReviewCardPresentation = (
  review: SellerReview,
  locale: string,
  copy: UserReviewCardAccessibilityCopy = defaultAccessibilityCopy,
): ReviewCardPresentation => {
  const comment = review.comment?.trim() ?? '';
  const reviewerName = review.reviewer?.username ?? copy.userFallback;
  const formattedDate = formatReviewDate(review.created_at, locale);
  const verifiedSegment = review.isVerifiedPurchase
    ? ` ${copy.verifiedPurchase}: ${review.product?.name ?? copy.itemFallback}.`
    : '';

  return {
    shouldRender: comment.length > 0,
    showVerifiedBadge: review.isVerifiedPurchase,
    formattedDate,
    accessibilityLabel: `${copy.reviewFrom} @${reviewerName}. ${copy.rating}: ${review.rating} ${copy.outOfFive}. ${copy.reviewedOn} ${formattedDate}. ${copy.comment}: ${comment || copy.noComment}.${verifiedSegment}`,
  };
};
