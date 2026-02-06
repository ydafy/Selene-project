import { useMemo } from 'react';
import { Product, ShippingOption } from '@selene/types';

const SERVICE_FEE_PERCENT = 0.03;
const SERVICE_FEE_FIXED = 5;

/**
 * @param items - Items en el carrito.
 * @param selectedShippingMethods - Mapa de ID de producto -> ShippingOption seleccionada.
 */
export const useOrderCalculations = (
  items: Product[],
  selectedShippingMethods: Record<string, ShippingOption> = {},
) => {
  return useMemo(() => {
    // 1. Subtotal
    const subtotal = items.reduce((sum, item) => sum + (item.price || 0), 0);

    // 2. Envío
    const shippingCost = items.reduce((sum, item) => {
      // Si el vendedor paga, el comprador paga 0
      if (item.shipping_payer === 'seller') return sum;

      // Buscamos la opción seleccionada por el usuario
      const selectedOption = selectedShippingMethods[item.id];
      if (selectedOption) {
        return sum + selectedOption.price;
      }

      return sum;
    }, 0);

    // 3. Tarifa de Servicio (3% sobre Subtotal + Envío)
    const rawServiceFee =
      (subtotal + shippingCost) * SERVICE_FEE_PERCENT + SERVICE_FEE_FIXED;
    const serviceFee = Math.round(rawServiceFee * 100) / 100;

    // 4. Total Final
    const total = subtotal + shippingCost + serviceFee;

    return {
      subtotal,
      shippingCost,
      serviceFee,
      total: Math.round(total * 100) / 100,
      totalInCents: Math.round(total * 100),
      itemCount: items.length,
    };
  }, [items, selectedShippingMethods]);
};
