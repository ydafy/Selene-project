import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { acknowledgeLateCarrierActivity, fetchLateCarrierActivity } from '../services/lateCarrierActivity';

export const LATE_CARRIER_ACTIVITY_KEY = ['late-carrier-activity'] as const;

/** Carrier activity after a cancellation refund started, waiting for an admin; `count` is null until the list is known. */
export function useLateCarrierActivity() {
  const query = useQuery({
    queryKey: LATE_CARRIER_ACTIVITY_KEY,
    queryFn: fetchLateCarrierActivity,
    refetchInterval: 30000,
  });
  return {
    cases: query.data ?? [],
    count: query.data ? query.data.length : null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useAcknowledgeLateCarrierActivity() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ shipmentId, note }: { shipmentId: string; note: string }) =>
      acknowledgeLateCarrierActivity(shipmentId, note),
    onSuccess: async () => {
      toast.success('Caso marcado como revisado');
      await queryClient.invalidateQueries({ queryKey: LATE_CARRIER_ACTIVITY_KEY });
    },
  });
  return {
    acknowledge: (shipmentId: string, note: string) => mutation.mutateAsync({ shipmentId, note }),
    isPending: mutation.isPending,
  };
}
