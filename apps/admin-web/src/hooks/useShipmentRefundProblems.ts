import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchShipmentRefundProblems, resolveShipmentRefund } from '../services/shipmentRefunds';

export const SHIPMENT_REFUND_PROBLEMS_KEY = ['shipment-refund-problems'] as const;

/** Unresolved buyer refund problems; `count` is null until the list is known. */
export function useShipmentRefundProblems() {
  const query = useQuery({
    queryKey: SHIPMENT_REFUND_PROBLEMS_KEY,
    queryFn: fetchShipmentRefundProblems,
    refetchInterval: 30000,
  });
  return {
    problems: query.data ?? [],
    count: query.data ? query.data.length : null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useResolveShipmentRefund() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ shipmentId, reference }: { shipmentId: string; reference: string }) =>
      resolveShipmentRefund(shipmentId, reference),
    onSuccess: async (result) => {
      if (result.resolved) toast.success('Reembolso marcado como resuelto');
      else toast.info(`Este reembolso ya estaba resuelto con la referencia: ${result.reference}`);
      await queryClient.invalidateQueries({ queryKey: SHIPMENT_REFUND_PROBLEMS_KEY });
    },
  });
  return {
    resolve: (shipmentId: string, reference: string) => mutation.mutateAsync({ shipmentId, reference }),
    isPending: mutation.isPending,
  };
}
