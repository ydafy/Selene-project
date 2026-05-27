import { useMemo } from 'react';
import { Product } from '@selene/types';
import { useSystemConfig } from './useSystemConfig';

export const useOrderCalculations = (items: Product[] = []) => {
  const { data: config } = useSystemConfig();

  return useMemo(() => {
    // Fallbacks sincronizados con la DB
    const PCT = config?.service_fee_pct ?? 0.05;
    const FIXED = config?.service_fee_fixed_cents ?? 500;

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

    // Calculamos subtotal en centavos
    const subtotalCents = items.reduce(
      (sum, item) => sum + Math.round((Number(item.price) || 0) * 100),
      0,
    );

    // Cálculo de comisión
    const feeFromPercent = Math.round(subtotalCents * PCT);
    const serviceFeeCents = feeFromPercent + FIXED;

    const totalCents = subtotalCents + serviceFeeCents;

    return {
      subtotal: subtotalCents / 100,
      shippingCost: 0,
      serviceFee: serviceFeeCents / 100,
      total: totalCents / 100,
      totalInCents: totalCents,
      itemCount: items.length,
    };
  }, [items, config]);
};
