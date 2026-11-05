import { useQuery } from '@tanstack/react-query';
import { useCartStore } from '../../../shared/store/use-cart-store';
import { useMemo } from 'react';

/** Reads which products can no longer be bought; the route passes the orders feature's check. */
export type ValidateProductStock = (
  productIds: string[],
) => Promise<{ unavailableIds: string[] }>;

export const useCartValidation = (
  validateProductStock: ValidateProductStock,
) => {
  const cartItems = useCartStore((state) => state.items);
  const cartIds = useMemo(() => cartItems.map((item) => item.id), [cartItems]);

  const query = useQuery({
    queryKey: ['cart-validation', cartIds],
    queryFn: () => validateProductStock(cartIds),
    enabled: cartIds.length > 0,
    staleTime: 1000 * 60, // 1 min
  });

  // Convertimos el array a un Set para que cart-item.tsx pueda hacer .has(id) eficientemente
  const unavailableIds = useMemo(
    () => new Set(query.data?.unavailableIds || []),
    [query.data?.unavailableIds],
  );

  return {
    ...query,
    unavailableIds, // <--- UI RESTAURADA
    hasUnavailableItems: unavailableIds.size > 0,
  };
};
