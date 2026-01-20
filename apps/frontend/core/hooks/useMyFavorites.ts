import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';

export const useMyFavorites = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['my-favorites', userId],
    queryFn: async () => {
      if (!userId) return [];

      // Hacemos un JOIN para traer los datos del producto asociado al favorito
      const { data, error } = await supabase
        .from('favorites')
        .select(
          `
          product:products (*)
        `,
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(6); // Solo traemos los últimos 6 para la vista previa

      if (error) throw error;

      // Mapeamos la respuesta para devolver una lista limpia de Productos
      // (Filtrando posibles nulos si un producto se borró)
      return data
        .map((item) => item.product)
        .filter(Boolean) as unknown as Product[];
    },
    enabled: !!userId,
  });
};
