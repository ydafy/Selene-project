import { CarrierReviewsBucket } from './CarrierReviewsBucket';
import { useCarrierReviews, useResolveCarrierReview } from '../../../hooks/useCarrierReviews';

/** Wires the carrier reviews query and resolution into their bucket. */
export const CarrierReviewsPanel = () => {
  const reviews = useCarrierReviews();
  const resolver = useResolveCarrierReview();
  return (
    <CarrierReviewsBucket
      reviews={reviews.reviews}
      isLoading={reviews.isLoading}
      isError={reviews.isError}
      isResolving={resolver.isPending}
      onRetry={() => void reviews.refetch()}
      onResolve={resolver.resolve}
    />
  );
};
