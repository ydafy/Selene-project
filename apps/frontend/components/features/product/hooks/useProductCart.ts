/**
 * @file core/hooks/useProductCart.ts
 * @description Hook de orquestación para la adición de productos al carrito.
 * Aplica JIT (Just-In-Time) Validation contra la DB antes de permitir el alta local.
 */

import { useState } from 'react';
import Toast from 'react-native-toast-message';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Product } from '@selene/types';
import { useCartStore } from '../../../../core/store/useCartStore';
import { supabase } from '../../../../core/db/supabase';
import {
  fetchSellerPaymentReadiness,
  isSellerBlocked,
} from '../../../../core/hooks/useSellerPaymentReadiness';
import {
  decidePurchaseGate,
  PurchaseDialogVariant,
} from '../../../../core/utils/productPurchaseGate';

export type AddToCartResult =
  'SUCCESS' | 'UNAVAILABLE' | 'ERROR' | PurchaseDialogVariant;

export const useProductCart = (product: Product | null | undefined) => {
  const { t } = useTranslation(['product', 'common']);
  const { addItem, isInCart } = useCartStore();
  const queryClient = useQueryClient();
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const isAdded = product ? isInCart(product.id) : false;

  /**
   * Maneja la validación y adición al carrito.
   */
  const handleAddToCart = async (): Promise<AddToCartResult> => {
    if (!product) return 'ERROR';

    if (isAdded) {
      Toast.show({
        type: 'info',
        text1: t('product:actions.alreadyInCartTitle'),
        text2: t('product:actions.alreadyInCartMsg'),
      });
      return 'SUCCESS';
    }

    setIsAddingToCart(true);

    try {
      // 1. CHECK: Fuente de verdad (DB); la vista ya oculta los soft deletes
      const { data: freshProduct, error } = await supabase
        .from('products_public')
        .select('status')
        .eq('id', product.id)
        .single();

      if (error || !freshProduct) throw new Error('PRODUCT_NOT_FOUND');

      // View rows are typed nullable; a matched row always carries its status.
      const freshStatus = freshProduct.status as Product['status'];

      // 2. CHECK: el vendedor puede recibir pagos (advisory; fail-open, el servidor decide)
      const sellerBlocked =
        freshStatus === 'VERIFIED' &&
        isSellerBlocked(
          await fetchSellerPaymentReadiness([product.id]),
          product.id,
        );

      // 3. VALIDAR: la pantalla abre el diálogo según el resultado
      const decision = decidePurchaseGate(freshStatus, sellerBlocked);

      if (freshStatus !== 'VERIFIED') {
        // Actualizamos la caché solo si el objeto existe en TanStack Query
        queryClient.setQueryData(
          ['product', product.id],
          (old: Product | undefined) => {
            return old ? { ...old, status: freshStatus } : old;
          },
        );
      }

      if (decision === 'unavailable') {
        Toast.show({
          type: 'error',
          text1: t('product:actions.notAvailable'),
          text2: t('product:actions.notAvailableMsg'),
        });
        return 'UNAVAILABLE';
      }

      if (decision !== 'add') return decision;

      // 4. ACT: Éxito
      addItem(product);

      Toast.show({
        type: 'success',
        text1: t('product:actions.addedToCartTitle'),
        text2: t('product:actions.addedToCartMsg', {
          productName: product.name,
        }),
        visibilityTime: 2000,
      });

      return 'SUCCESS';
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      console.error('[useProductCart] Error:', msg);

      Toast.show({
        type: 'error',
        text1: t('common:errors.errorTitle'),
        text2: t('product:errors.verificationFailed'),
      });
      return 'ERROR';
    } finally {
      setIsAddingToCart(false);
    }
  };

  return { handleAddToCart, isAddingToCart, isAdded };
};
