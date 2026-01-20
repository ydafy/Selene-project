import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';

export const useAdminProducts = () => {
  return useQuery({
    queryKey: ['admin-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'IN_REVIEW') // Solo lo que requiere acción
        .order('created_at', { ascending: true }); // FIFO: Los más viejos primero (para ser justos)

      if (error) throw error;
      return data as Product[];
    },
  });
};
