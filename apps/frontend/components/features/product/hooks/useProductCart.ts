import { useState } from 'react';
import Toast from 'react-native-toast-message';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query'; // <-- Importar QueryClient
import { Product } from '@selene/types';
import { useCartStore } from '../../../../core/store/useCartStore';
import { supabase } from '../../../../core/db/supabase'; // <-- Importar Supabase

export const useProductCart = (product: Product | undefined) => {
  const { t } = useTranslation('product');
  const { addItem, isInCart } = useCartStore();
  const queryClient = useQueryClient(); // <-- Para actualizar la UI si cambió el status

  const [isAddingToCart, setIsAddingToCart] = useState(false);

  const isAdded = product ? isInCart(product.id) : false;

  const handleAddToCart = async () => {
    // <-- Ahora es async
    if (!product) return;

    if (isAdded) {
      Toast.show({
        type: 'info',
        text1: t('actions.alreadyInCartTitle'),
        text2: t('actions.alreadyInCartMsg'),
        position: 'top',
      });
      return;
    }

    setIsAddingToCart(true);

    try {
      // 1. CHECK (Verificar): Consultamos el estado MÁS RECIENTE en la DB
      const { data: freshProduct, error } = await supabase
        .from('products')
        .select('status')
        .eq('id', product.id)
        .single();

      if (error) throw error;

      // 2. VALIDAR: ¿Sigue estando VERIFIED?
      if (freshProduct.status !== 'VERIFIED') {
        // CASO: YA SE VENDIÓ (O fue pausado/borrado)

        // A. Avisamos al usuario
        Toast.show({
          type: 'error',
          text1: t('actions.notAvailable'),
          text2: t('actions.notAvailableMsg'),
          position: 'top',
        });

        // B. Actualizamos la UI localmente para reflejar la realidad
        // Esto hará que el botón cambie a "Vendido" o "Pendiente" automáticamente
        queryClient.setQueryData(['product', product.id], (old: Product) => ({
          ...old,
          status: freshProduct.status,
        }));

        return; // Detenemos el flujo, no añadimos al carrito
      }

      // 3. ACT (Actuar): Si todo está bien, añadimos al carrito
      addItem(product);

      Toast.show({
        type: 'success',
        text1: t('actions.addedToCartTitle'),
        text2: t('actions.addedToCartMsg', { productName: product.name }),
        position: 'top',
        visibilityTime: 2000,
      });
    } catch (error) {
      console.error(error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo verificar la disponibilidad.',
        position: 'top',
      });
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
