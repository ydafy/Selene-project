import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  recordPayoutHoldNote,
  refundOverduePayout,
} from '../lib/overdue-payouts-api';
import { getErrorCode } from '@/shared/utils/get-error-code';
import { centsToMoney } from '@/shared/utils/cents-to-money';
import { formatCurrency } from '@/shared/utils/format-currency';
import {
  CONNECT_PAYOUT_RELEASE_QUEUE_KEY,
  SHIPMENT_REFUND_PROBLEMS_KEY,
} from './payment-query-keys';

/** Keeps an overdue payout on hold with a note, then refreshes the queue to show it. */
export function useRecordPayoutHoldNote() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ shipmentId, note }: { shipmentId: string; note: string }) =>
      recordPayoutHoldNote(shipmentId, note),
    onSuccess: async () => {
      toast.success('Nota guardada; el pago sigue retenido.');
      await queryClient.invalidateQueries({
        queryKey: CONNECT_PAYOUT_RELEASE_QUEUE_KEY,
      });
    },
  });
  return {
    record: (shipmentId: string, note: string) =>
      mutation.mutateAsync({ shipmentId, note }),
    isPending: mutation.isPending,
  };
}

/**
 * Refunds the buyer of an overdue payout. Every answer refreshes the queue, since
 * a refusal can mean the shipment changed; a failed Stripe refund also lands in
 * the refund problems list.
 */
export function useRefundOverduePayout() {
  const queryClient = useQueryClient();
  const refreshQueue = () =>
    queryClient.invalidateQueries({
      queryKey: CONNECT_PAYOUT_RELEASE_QUEUE_KEY,
    });
  const mutation = useMutation({
    mutationFn: (shipmentId: string) => refundOverduePayout(shipmentId),
    onSuccess: async (result) => {
      const amount = formatCurrency(centsToMoney(result.amountCents));
      if (result.status === 'refunded')
        toast.success(`Reembolso hecho: ${amount} al comprador.`);
      else toast.info(`Reembolso de ${amount} pendiente en Stripe.`);
      await refreshQueue();
    },
    onError: async (error) => {
      await refreshQueue();
      if (getErrorCode(error) === 'REFUND_FAILED')
        await queryClient.invalidateQueries({
          queryKey: SHIPMENT_REFUND_PROBLEMS_KEY,
        });
    },
  });
  return {
    refund: (shipmentId: string) => mutation.mutateAsync(shipmentId),
    isPending: mutation.isPending,
  };
}
