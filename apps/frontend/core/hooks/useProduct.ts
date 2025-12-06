import { useQuery, useQueryClient } from '@tanstack/react-query'; // 1. Importamos useQueryClient
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';

const fetchProductById = async (id: string): Promise<Product> => {
  const { data, error } = await supabase
    .from('products')
    .select(
      `
      *,
      profiles:seller_id (
        id,
        username,
        avatar_url
      )
    `,
    )
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data as Product;
};

export const useProduct = (id: string) => {
  const queryClient = useQueryClient(); // 2. Obtenemos acceso a la caché global

  return useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProductById(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutos

    // --- 3. LA MAGIA DE LA ANIMACIÓN ---
    placeholderData: () => {
      // Buscamos en la caché de la lista general ('products')
      const cachedProducts = queryClient.getQueryData<Product[]>(['products']);

      // Si encontramos el producto ahí, lo usamos inmediatamente.
      // Esto hace que isLoading sea FALSE desde el milisegundo 0.
      return cachedProducts?.find((p) => p.id === id);
    },
    // -----------------------------------
  });
};
