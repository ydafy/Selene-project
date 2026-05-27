/**
 * @file core/hooks/useProductManagement.ts
 * @description Hook para la gestión administrativa de productos por parte del vendedor.
 * Implementa borrado lógico (Soft Delete) para preservar la integridad referencial.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { supabase } from '../db/supabase';

export const useProductManagement = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['profile', 'common']);

  const deleteMutation = useMutation({
    /**
     * Realiza un Soft Delete del producto.
     * No eliminamos la fila para no romper el historial de ventas/disputas.
     */
    mutationFn: async (productId: string) => {
      const { error } = await supabase
        .from('products')
        .update({
          deleted_at: new Date().toISOString(),
          status: 'HIDDEN', // Lo ocultamos del catálogo inmediatamente
        })
        .eq('id', productId);

      if (error) throw error;
    },
    onSuccess: () => {
      Toast.show({
        type: 'success',
        text1: t(
          'profile:listings.toast.deleteSuccessTitle',
          'Producto eliminado',
        ),
        text2: t(
          'profile:listings.toast.deleteSuccessMsg',
          'Tu publicación ha sido retirada.',
        ),
      });

      // Refrescamos las listas para que el producto "desaparezca" de la vista activa
      queryClient.invalidateQueries({ queryKey: ['my-listings'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: Error) => {
      Toast.show({
        type: 'error',
        text1: t('common:errors.errorTitle', 'Error'),
        text2: error.message || t('common:errors.generic'),
      });
    },
  });

  return {
    deleteProduct: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
};
