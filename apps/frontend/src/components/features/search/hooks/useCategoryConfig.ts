/**
 * @file core/hooks/useCategoryConfig.ts
 * @description Obtiene la configuración de campos de filtro y venta para una categoría específica.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../../core/db/supabase';
import { Tables } from '@selene/types';

export const useCategoryConfig = (category?: string) => {
  return useQuery({
    queryKey: ['category-config', category],
    queryFn: async (): Promise<Tables<'category_configurations'> | null> => {
      if (!category) return null;

      const { data, error } = await supabase
        .from('category_configurations')
        .select('*')
        .eq('category_name', category)
        .maybeSingle(); // Usamos maybeSingle para manejar categorías no configuradas

      if (error) throw error;
      return data;
    },
    // Solo se ejecuta si hay una categoría válida
    enabled: !!category && category !== 'All',
    staleTime: 1000 * 60 * 60 * 24, // 24 horas
  });
};
