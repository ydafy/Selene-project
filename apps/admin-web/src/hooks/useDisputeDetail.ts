import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Shape of the evidence JSON stored by the buyer and seller flows. */
interface DisputeEvidence {
  images?: string[];
  video_url?: string;
  tech_checklist?: Record<string, unknown>;
}

const fetchDisputeRow = (id: string) =>
  supabase
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

type DisputeRow = NonNullable<
  Awaited<ReturnType<typeof fetchDisputeRow>>['data']
>;

export type DisputeDetail = Omit<
  DisputeRow,
  'status' | 'buyer_evidence' | 'shipment'
> & {
  status: NonNullable<DisputeRow['status']>;
  buyer_evidence: DisputeEvidence | null;
  shipment:
    | (Omit<NonNullable<DisputeRow['shipment']>, 'shipping_evidence'> & {
        shipping_evidence: DisputeEvidence | null;
      })
    | null;
};

export const useDisputeDetail = (id: string) => {
  return useQuery({
    queryKey: ['dispute-detail', id],
    queryFn: async () => {
      const { data, error } = await fetchDisputeRow(id);

      if (error) {
        console.error('❌ Error en useDisputeDetail:', error.message);
        throw error;
      }

      // The evidence columns are untyped JSON; their shape is fixed by the writers.
      return data as unknown as DisputeDetail;
    },
    enabled: !!id,
  });
};
