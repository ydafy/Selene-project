import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../../core/db/supabase';
import { useCartStore } from '../../../../core/store/useCartStore';

export const useCartValidation = () => {
  const cartItems = useCartStore((state) => state.items);

  // Extraemos solo los IDs para la consulta
  const cartIds = cartItems.map((item) => item.id);

  const query = useQuery({
    queryKey: ['cart-validation', cartIds], // Se refresca si cambian los items
    queryFn: async () => {
      if (cartIds.length === 0) return [];
      // Pedimos a Supabase solo el ID y el STATUS de los productos en el carrito
      const { data, error } = await supabase
        .from('products')
        .select('id, status')
        .in('id', cartIds);

      if (error) {
        throw error;
      }
      return data;
    },
    // Validamos cada vez que entra a la pantalla
    refetchOnMount: true,

    staleTime: 0,
    enabled: cartIds.length > 0,
    refetchInterval: 5000,
  });

  // Calculamos qué IDs ya no son válidos (no están VERIFIED)
  const unavailableIds = new Set<string>();

  if (query.data) {
    query.data.forEach((item) => {
      if (item.status !== 'VERIFIED') {
        unavailableIds.add(item.id);
      }
    });
  }

  return {
    ...query,
    unavailableIds, // Un Set con los IDs problemáticos
    hasUnavailableItems: unavailableIds.size > 0,
  };
};
