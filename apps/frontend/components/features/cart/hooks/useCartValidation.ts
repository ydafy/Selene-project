import { useQuery } from '@tanstack/react-query';
import { useCartStore } from '../../../../core/store/useCartStore';
import { OrderService } from '../../../../core/services/order';
import { useMemo } from 'react';

export const useCartValidation = () => {
  const cartItems = useCartStore((state) => state.items);
  const cartIds = useMemo(() => cartItems.map((item) => item.id), [cartItems]);

  const query = useQuery({
    queryKey: ['cart-validation', cartIds],
    queryFn: () => OrderService.validateProductStock(cartIds),
    enabled: cartIds.length > 0,
    staleTime: 1000 * 60, // 1 min
  });

  // Convertimos el array a un Set para que CartItem.tsx pueda hacer .has(id) eficientemente
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
