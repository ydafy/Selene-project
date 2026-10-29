import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getErrorCode } from '../lib/shipmentRefundProblems';
import { fetchLabelReconciliations, resolveLabelReconciliation } from '../services/labelReconciliations';

export const LABEL_RECONCILIATIONS_KEY = ['label-reconciliations'] as const;

/** Shipments whose label outcome is unproven, waiting for an admin; `count` is null until the list is known. */
export function useLabelReconciliations() {
  const query = useQuery({
    queryKey: LABEL_RECONCILIATIONS_KEY,
    queryFn: fetchLabelReconciliations,
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

export function useResolveLabelReconciliation() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: LABEL_RECONCILIATIONS_KEY });
  const mutation = useMutation({
    mutationFn: resolveLabelReconciliation,
    onSuccess: async (result) => {
      toast.success(
        result.resolution === 'label_found'
          ? 'Guía registrada: el envío sigue su curso'
          : 'Envío liberado: el vendedor puede generar la guía de nuevo',
      );
      await refresh();
    },
    // Someone else already settled it: the row is stale, so the list is refreshed.
    onError: async (error) => {
      if (getErrorCode(error) === 'ALREADY_RESOLVED') await refresh();
    },
  });
  return {
    resolve: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
