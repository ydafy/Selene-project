import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export const useDisputeDetail = (id: string) => {
  return useQuery({
    queryKey: ['dispute-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('disputes')
        .select(
          `
          *,
          buyer:profiles!buyer_id (username, avatar_url, id),
          seller:profiles!seller_id (username, avatar_url, id),
          resolved_admin:profiles!resolved_by (username),
          order:orders!order_id (*, shipping_address),
          shipment:shipments!shipment_id (id, shipping_evidence, origin_address, tracking_number)
        `,
        )
        .eq('id', id)
        .single();

      if (error) {
        console.error('❌ Error en useDisputeDetail:', error.message);
        throw error;
      }

      return data as any;
    },
    enabled: !!id,
  });
};