import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';

export const useMyFavorites = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['my-favorites', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from('favorites')
        .select(
          `
          product:products!inner (*)
        `,
        )
        .eq('user_id', userId)

        .is('products.deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(6);
      if (error) throw error;

      // El !inner garantiza que item.product nunca sea nulo, pero mantenemos el filtro por sanidad
      return data
        .map((item) => item.product)
        .filter(Boolean) as unknown as Product[];
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!userId,
  });
};
