import { useQuery } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';

const fetchProductById = async (id: string): Promise<Product> => {
  const { data, error } = await supabase
    .from('products')
    .select(
      `
      *,
      profiles:seller_id (id, username, avatar_url)
    `,
    )
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data as Product;
};

export const useProduct = (id: string) => {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProductById(id),
    enabled: !!id,
    // Volvemos a un tiempo de caché razonable (ej. 1 minuto)
    // Si el usuario entra y sale rápido, no recargamos.
    staleTime: 1000 * 60 * 5, // 5 minutos
  });
};
