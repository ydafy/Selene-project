import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';
import { useProductHistoryStore } from '../store/useProductHistoryStore';

export const useRecentlyViewed = () => {
  const { viewedIds } = useProductHistoryStore();

  return useQuery({
    queryKey: ['recently-viewed', viewedIds],
    queryFn: async (): Promise<Product[]> => {
      if (viewedIds.length === 0) return [];

      const { data, error } = await supabase
        .from('products')
        .select('*')
        .in('id', viewedIds)

        .not('status', 'in', '(HIDDEN,REJECTED)');

      if (error) throw error;

      // Re-ordenar para mantener el orden cronológico del historial
      return (data as Product[]).sort(
        (a, b) => viewedIds.indexOf(a.id) - viewedIds.indexOf(b.id),
      );
    },
    enabled: viewedIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });
};
