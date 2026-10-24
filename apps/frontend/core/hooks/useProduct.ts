import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Product, ProductWithSeller } from '@selene/types';
import { useAuthContext } from '../../components/auth/AuthProvider';

const PRODUCT_WITH_SELLER = `*, seller:profiles!products_seller_id_fkey(*)`;

/**
 * Función de servicio blindada.
 * Everyone reads the public view first. A signed-in user who finds no row may
 * be the owner (or an admin) of a listing the view hides (HIDDEN, REJECTED,
 * RESERVED, IN_DISPUTE), so the table is read next; its RLS returns the row
 * only to them.
 */
const fetchProductById = async (
  id: string,
  canBeOwner: boolean,
): Promise<ProductWithSeller | null> => {
  const { data, error } = await supabase
    .from('products_public')
    .select(PRODUCT_WITH_SELLER)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (data || !canBeOwner) {
    // Hacemos el cast al nuevo tipo
    return data as unknown as ProductWithSeller | null;
  }

  const { data: owned, error: ownedError } = await supabase
    .from('products')
    .select(PRODUCT_WITH_SELLER)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (ownedError) throw ownedError;
  return owned as unknown as ProductWithSeller | null;
};
export const useProduct = (id: string) => {
  const queryClient = useQueryClient();
  const { session } = useAuthContext();
  const userId = session?.user.id;

  return useQuery({
    // The result depends on who asks (view row, or the owner's table row), so
    // a session that arrives late gets its own entry instead of a cached null.
    queryKey: ['product', id, userId ?? null],
    queryFn: () => fetchProductById(id, !!userId),
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
  });
};
