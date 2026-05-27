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

export const useProductCart = (product: Product | null | undefined) => {
  const { t } = useTranslation(['product', 'common']);
  const { addItem, isInCart } = useCartStore();
  const queryClient = useQueryClient();
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const isAdded = product ? isInCart(product.id) : false;

  /**
   * Maneja la validación y adición al carrito.
   */
  const handleAddToCart = async (): Promise<
    'SUCCESS' | 'NOT_VERIFIED' | 'SOLD' | 'ERROR'
  > => {
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
      // 1. CHECK: Fuente de verdad (DB) filtrando por soft deletes
      const { data: freshProduct, error } = await supabase
        .from('products')
        .select('status')
        .eq('id', product.id)
        .is('deleted_at', null)
        .single();

      if (error || !freshProduct) throw new Error('PRODUCT_NOT_FOUND');

      // 2. VALIDAR: Actualización inteligente de caché
      if (freshProduct.status !== 'VERIFIED') {
        // Actualizamos la caché solo si el objeto existe en TanStack Query
        queryClient.setQueryData(
          ['product', product.id],
          (old: Product | undefined) => {
            return old ? { ...old, status: freshProduct.status } : old;
          },
        );

        if (freshProduct.status === 'SOLD') {
          Toast.show({
            type: 'error',
            text1: t('product:actions.notAvailable'),
            text2: t('product:actions.notAvailableMsg'),
          });
          return 'SOLD';
        }

        return 'NOT_VERIFIED';
      }

      // 3. ACT: Éxito
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
