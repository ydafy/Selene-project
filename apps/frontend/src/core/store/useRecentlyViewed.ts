import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { PublicProduct } from '@selene/types';
import { useProductHistoryStore } from '../store/useProductHistoryStore';
import { BUYER_LISTED_STATUSES } from '../utils/productListingStatus';

export const useRecentlyViewed = () => {
  const { viewedIds } = useProductHistoryStore();

  return useQuery({
    queryKey: ['recently-viewed', viewedIds],
    queryFn: async (): Promise<PublicProduct[]> => {
      if (viewedIds.length === 0) return [];

      const { data, error } = await supabase
        .from('products_public')
        .select('*')
        .in('id', viewedIds)
        // Listings buyers can find, in verification included (L31); never
        // rely on RLS to hide rejected, hidden or reserved listings.
        .in('status', BUYER_LISTED_STATUSES);

      if (error) throw error;

      // Re-ordenar para mantener el orden cronológico del historial
      return (data as PublicProduct[]).sort(
        (a, b) => viewedIds.indexOf(a.id) - viewedIds.indexOf(b.id),
      );
    },
    enabled: viewedIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });
};
