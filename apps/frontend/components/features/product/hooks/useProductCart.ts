import { useState } from 'react';
import Toast from 'react-native-toast-message';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Product } from '@selene/types';
import { useCartStore } from '../../../../core/store/useCartStore';
import { supabase } from '../../../../core/db/supabase';

export const useProductCart = (product: Product | undefined) => {
  const { t } = useTranslation('product');
  const { addItem, isInCart } = useCartStore();
  const queryClient = useQueryClient();
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const isAdded = product ? isInCart(product.id) : false;

  // Definimos los posibles resultados de la acción
  const handleAddToCart = async (): Promise<
    'SUCCESS' | 'NOT_VERIFIED' | 'SOLD' | 'ERROR'
  > => {
    // Validación inicial: Si no hay producto cargado, es un error técnico
    if (!product) return 'ERROR';

    // Si ya está en el carrito, mostramos el Toast informativo y terminamos como éxito
    if (isAdded) {
      Toast.show({
        type: 'info',
        text1: t('actions.alreadyInCartTitle'),
        text2: t('actions.alreadyInCartMsg'),
        position: 'top',
      });
      return 'SUCCESS';
    }

    setIsAddingToCart(true);

    try {
      // 1. CHECK: Consultamos el estado MÁS RECIENTE en la DB (Fuente de verdad)
      const { data: freshProduct, error } = await supabase
        .from('products')
        .select('status')
        .eq('id', product.id)
        .single();

      if (error) throw error;

      // 2. VALIDAR: ¿El estado permite la compra?
      if (freshProduct.status !== 'VERIFIED') {
        // A. Actualizamos la caché local de React Query para que la UI se entere del cambio
        queryClient.setQueryData(['product', product.id], (old: Product) => ({
          ...old,
          status: freshProduct.status,
        }));

        // B. Manejo de casos específicos
        if (freshProduct.status === 'SOLD') {
          Toast.show({
            type: 'error',
            text1: t('actions.notAvailable'),
            text2: t('actions.notAvailableMsg'),
            position: 'top',
          });
          return 'SOLD';
        }

        // Si es PENDING o IN_REVIEW, retornamos este código especial
        // para que la UI muestre el Diálogo Educativo en lugar de un error.
        return 'NOT_VERIFIED';
      }

      // 3. ACT: Si es VERIFIED, procedemos a añadir al carrito
      addItem(product);

      Toast.show({
        type: 'success',
        text1: t('actions.addedToCartTitle'),
        text2: t('actions.addedToCartMsg', { productName: product.name }),
        position: 'top',
        visibilityTime: 2000,
      });

      return 'SUCCESS';
    } catch (error) {
      console.error(error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo verificar la disponibilidad.',
        position: 'top',
      });
      return 'ERROR';
    } finally {
      setIsAddingToCart(false);
    }
  };
  return {
    handleAddToCart,
    isAddingToCart,
    isAdded,
  };
};
