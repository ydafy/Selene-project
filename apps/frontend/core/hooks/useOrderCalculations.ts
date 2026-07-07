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
import { calculateSeguroSelene } from '../utils/connectPayment';

export const useOrderCalculations = (items: Product[] = []) => {
  return useMemo(() => {
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

    // Calculate subtotal in centavos.
    const subtotalCents = items.reduce(
      (sum, item) => sum + Math.round((Number(item.price) || 0) * 100),
      0,
    );

    // Buyer-facing Seguro Selene. Seller shipping and Selene commission are
    // seller-side deductions in the Connect flow, not buyer charges.
    const serviceFeeCents = Math.round(
      calculateSeguroSelene(subtotalCents / 100) * 100,
    );

    const totalCents = subtotalCents + serviceFeeCents;

    return {
      subtotal: subtotalCents / 100,
      shippingCost: 0,
      serviceFee: serviceFeeCents / 100,
      total: totalCents / 100,
      totalInCents: totalCents,
      itemCount: items.length,
    };
  }, [items]);
};
