import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ReviewResolution } from '../lib/carrierReviews';
import { fetchCarrierReviews, resolveCarrierReview } from '../services/carrierReviews';

export const CARRIER_REVIEWS_KEY = ['carrier-reviews'] as const;

/** Carrier cancellations waiting for an admin; `count` is null until the list is known. */
export function useCarrierReviews() {
  const query = useQuery({
    queryKey: CARRIER_REVIEWS_KEY,
    queryFn: fetchCarrierReviews,
    refetchInterval: 30000,
  });
  return {
    reviews: query.data ?? [],
    count: query.data ? query.data.length : null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useResolveCarrierReview() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ shipmentId, resolution, note }: { shipmentId: string; resolution: ReviewResolution; note: string }) =>
      resolveCarrierReview(shipmentId, resolution, note),
    onSuccess: async (result) => {
      if (result.resolution === 'refund_approved') {
        toast.success('Reembolso aprobado. El próximo ciclo automático lo ejecutará.');
      } else {
        toast.success('Cancelación cerrada sin reembolso');
      }
      await queryClient.invalidateQueries({ queryKey: CARRIER_REVIEWS_KEY });
    },
  });
  return {
    resolve: (shipmentId: string, resolution: ReviewResolution, note: string) =>
      mutation.mutateAsync({ shipmentId, resolution, note }),
    isPending: mutation.isPending,
  };
}
