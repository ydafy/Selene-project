import { useMemo } from 'react';
import { Product } from '@selene/types';

/**
 * CONFIGURACIÓN DE COMISIONES (Protección Selene)
 * Basado en: Stripe MX (3.6% + $3) + Margen Selene + IVA sobre comisión.
 */
export const SERVICE_FEE_CONFIG = {
  PERCENT: 0.05, // Subimos a 5% para cubrir Stripe (3.6%) + IVA + Seguro Selene
  FIXED_CENTS: 500, // $5.00 MXN en centavos
};

export const useOrderCalculations = (items: Product[] = []) => {
  return useMemo(() => {
    // 1. Manejo de carrito vacío
    if (!items || items.length === 0) {
      return {
        subtotal: 0,
        shippingCost: 0,
        serviceFee: 0,
        total: 0,
        totalInCents: 0,
        itemCount: 0,
      };
    }

    // --- CÁLCULOS EN CENTAVOS (Para evitar errores de JS) ---

    // 2. Subtotal en centavos
    const subtotalCents = items.reduce((sum, item) => {
      const price = Math.round((Number(item.price) || 0) * 100);
      return sum + price;
    }, 0);

    // 3. Envío (Estrategia: Envío Incluido = $0 para el comprador)
    const shippingCostCents = 0;

    // 4. Tarifa de Servicio (Protección Selene)
    // Calculamos: (Subtotal * %) + Fijo
    const feeFromPercent = Math.round(
      subtotalCents * SERVICE_FEE_CONFIG.PERCENT,
    );
    const serviceFeeCents = feeFromPercent + SERVICE_FEE_CONFIG.FIXED_CENTS;

    // 5. Total Final en centavos
    const totalCents = subtotalCents + shippingCostCents + serviceFeeCents;

    // --- CONVERSIÓN PARA UI (Pesos) ---
    return {
      subtotal: subtotalCents / 100,
      shippingCost: 0, // Siempre 0 para el comprador
      serviceFee: serviceFeeCents / 100,
      total: totalCents / 100,
      totalInCents: totalCents, // Este es el valor que va a Stripe
      itemCount: items.length,
    };
  }, [items]);
};
