/**
 * @file apps/frontend/core/hooks/useOrderCalculations.ts
 * @description Custom React Hook for computing real-time order breakdown figures in the client-side cart.
 *
 * Implements:
 * 1. Thread-safe mathematical subtotal calculations in integer cents to prevent JS float precision loss.
 * 2. Buyer-facing transaction fees ("Seguro Selene") using the shared calculateSeguroSelene utility.
 * 3. Enforces the buyer-facing shipping cost as $0 (free shipping) as shipping costs are seller-side deductions.
 *
 * Uses React useMemo to prevent redundant calculations on UI state changes.
 *
 * @version 1.0
 * @domain checkout-math-hooks
 */

import { useMemo } from 'react';
import { Product } from '@selene/types';
import { grossUpDomesticMx } from '../utils/stripeFeeGrossUp';

export const calculateOrderCalculations = (items: Product[] = []) => {
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

  const subtotalCents = items.reduce(
    (sum, item) => sum + Math.round((Number(item.price) || 0) * 100),
    0,
  );

  const { buyerTotalCents, seguroCents } = grossUpDomesticMx(subtotalCents);

  return {
    subtotal: subtotalCents / 100,
    shippingCost: 0,
    serviceFee: seguroCents / 100,
    total: buyerTotalCents / 100,
    totalInCents: buyerTotalCents,
    itemCount: items.length,
  };
};

export const useOrderCalculations = (items: Product[] = []) => {
  return useMemo(() => calculateOrderCalculations(items), [items]);
};
