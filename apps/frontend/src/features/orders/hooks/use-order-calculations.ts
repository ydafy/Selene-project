/**
 * @file apps/frontend/src/features/orders/hooks/use-order-calculations.ts
 * @description Custom React Hook for computing real-time order breakdown figures in the client-side cart.
 *
 * Implements:
 * 1. Subtotal as the integer sum of `price_cents`; every returned amount is integer cents.
 * 2. Buyer-facing transaction fees ("Seguro Selene") using the shared grossUpDomesticMx utility.
 * 3. Enforces the buyer-facing shipping cost as $0 (free shipping) as shipping costs are seller-side deductions.
 *
 * Uses React useMemo to prevent redundant calculations on UI state changes.
 *
 * @version 1.0
 * @domain checkout-math-hooks
 */

import { useMemo } from 'react';
import { Product } from '@selene/types';
import { grossUpDomesticMx } from '@/shared/utils/money/stripe-fee-gross-up';

export const calculateOrderCalculations = (items: Product[] = []) => {
  if (!items || items.length === 0) {
    return {
      subtotalCents: 0,
      shippingCostCents: 0,
      serviceFeeCents: 0,
      totalCents: 0,
      itemCount: 0,
    };
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.price_cents, 0);

  const { buyerTotalCents, seguroCents } = grossUpDomesticMx(subtotalCents);

  return {
    subtotalCents,
    shippingCostCents: 0,
    serviceFeeCents: seguroCents,
    totalCents: buyerTotalCents,
    itemCount: items.length,
  };
};

export const useOrderCalculations = (items: Product[] = []) => {
  return useMemo(() => calculateOrderCalculations(items), [items]);
};
