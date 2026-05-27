import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product, ProductWithSeller } from '@selene/types';

/**
 * Función de servicio blindada
 */
const fetchProductById = async (
  id: string,
): Promise<ProductWithSeller | null> => {
  const { data, error } = await supabase
    .from('products')
    .select(`*, seller:profiles!products_seller_id_fkey(*)`)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;

  // Hacemos el cast al nuevo tipo
  return data as unknown as ProductWithSeller | null;
};
export const useProduct = (id: string) => {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProductById(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutos

    // --- 🚀 LA MAGIA DE LA ANIMACIÓN (RESTURADA Y MEJORADA) ---
    placeholderData: (previousData) => {
      if (previousData) return previousData;

      const cachedProducts = queryClient.getQueryData<Product[]>(['products']);
      const foundProduct = cachedProducts?.find((p) => p.id === id);

      // FIX: Casteamos el producto de la caché para que TypeScript no llore por la falta del 'seller'.
      // La UI mostrará el producto al instante, y el 'seller' cargará medio segundo después.
      return foundProduct
        ? (foundProduct as unknown as ProductWithSeller)
        : undefined;
    },
    // --------------------------------------------------------
  });
};
