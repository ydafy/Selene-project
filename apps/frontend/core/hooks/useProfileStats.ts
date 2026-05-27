/**
 * @file core/hooks/useProfileStats.ts
 * @description Obtiene las estadísticas de reputación directamente del perfil.
 * Optimizado para usar las columnas pre-calculadas por Triggers.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';

export type ProfileStats = {
  sales_count: number;
  rating_average: number;
  reviews_count: number;
};

export const useProfileStats = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['profile-stats', userId],
    queryFn: async () => {
      if (!userId) return null;
      // Ya no usamos RPC. Pedimos las columnas directamente de profiles.
      const { data, error } = await supabase
        .from('profiles')
        .select('total_sales, average_rating, total_reviews')
        .eq('id', userId)
        .single();

      if (error) throw error;

      return {
        sales_count: data.total_sales ?? 0,
        rating_average: Number(data.average_rating ?? 0),
        reviews_count: data.total_reviews ?? 0,
      };
    },
    enabled: !!userId,
  });
};
