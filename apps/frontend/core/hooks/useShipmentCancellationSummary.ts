import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { useAuthContext } from '../../components/auth/AuthProvider';
import type { ShipmentCancellationSummary } from '../utils/shipment-cancellation-summary';

// The RPC also answers for unfinished cancellation operations, so it is only
// called once the shipment itself is cancelled. Failures and empty answers
// resolve to no summary: the banner keeps its original text.
export const useShipmentCancellationSummary = (
  shipmentId: string | undefined,
  status: string | undefined,
) => {
  const { session } = useAuthContext();
  const userId = session?.user.id || '';

  const query = useQuery({
    queryKey: ['shipment-cancellation-summary', shipmentId, userId],
    queryFn: async (): Promise<ShipmentCancellationSummary | null> => {
      if (!shipmentId) return null;
      const { data, error } = await supabase.rpc(
        'fn_get_shipment_cancellation_summary',
        { p_shipment_id: shipmentId },
      );
      if (error) throw error;
      const row = data?.[0] ?? null;
      return row ? { source: row.source, refundState: row.refund_state } : null;
    },
    enabled: !!shipmentId && !!userId && status === 'cancelled',
  });

  return query.data ?? null;
};
