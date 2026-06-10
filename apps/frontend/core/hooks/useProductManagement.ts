/**
 * @file core/hooks/useProductManagement.ts
 * @description Hook for seller product management with optimistic delete,
 *   pre-flight guards (ownership, dispute, SOLD/RESERVED), and iOS haptics.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import Toast from 'react-native-toast-message';
import { supabase } from '../db/supabase';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { Product } from '@selene/types';

// Type for mutation context (optimistic cache snapshots)
type DeleteContext = {
  prevListings: unknown;
  prevProducts: unknown;
};

// Conditional haptics import — some platforms may not support expo-haptics
let Haptics: typeof import('expo-haptics') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Haptics = require('expo-haptics');
} catch {
  // expo-haptics not available on this platform
}

export const useProductManagement = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['profile', 'common']);
  const { session } = useAuthContext();
  const currentUserId = session?.user.id;

  const deleteMutation = useMutation<
    void,
    Error,
    Product, // Accept full product object for pre-flight checks
    DeleteContext
  >({
    onMutate: async (product) => {
      // ── Pre-flight guards (no network call) ──

      // 1. Ownership guard
      if (product.seller_id !== currentUserId) {
        Toast.show({
          type: 'error',
          text1: t(
            'profile:listings.toast.deleteForbiddenTitle',
            'No autorizado',
          ),
          text2: t(
            'profile:listings.toast.deleteForbiddenMsg',
            'Solo puedes eliminar tus propias publicaciones.',
          ),
        });
        throw new Error('FORBIDDEN_NOT_OWNER');
      }

      // 2. Status guard — SOLD, RESERVED, or IN_DISPUTE cannot be deleted.
      //    IN_DISPUTE is set by the DB trigger — no network probe needed.
      if (
        product.status === 'SOLD' ||
        product.status === 'RESERVED' ||
        product.status === 'IN_DISPUTE'
      ) {
        Toast.show({
          type: 'error',
          text1: t(
            'profile:listings.toast.deleteBlockedStatusTitle',
            'No se puede eliminar',
          ),
          text2: t(
            'profile:listings.toast.deleteBlockedStatusMsg',
            'Los productos vendidos o reservados no se pueden eliminar.',
          ),
        });
        throw new Error('BLOCKED_STATUS');
      }

      // 3. Dispute guard — trust local status (IN_DISPUTE caught by guard #2).
      //    No network probe needed: the DB trigger syncs status on dispute open.
      //    If product is IN_DISPUTE, guard #2 already blocked it.

      // ── Optimistic update ──
      await queryClient.cancelQueries({ queryKey: ['my-listings'] });
      await queryClient.cancelQueries({ queryKey: ['products'] });

      const prevListings = queryClient.getQueryData(['my-listings']);
      const prevProducts = queryClient.getQueryData(['products']);

      queryClient.setQueryData(['my-listings'], (old: Product[] | undefined) =>
        old ? old.filter((p) => p.id !== product.id) : old,
      );
      queryClient.setQueryData(['products'], (old: Product[] | undefined) =>
        old ? old.filter((p) => p.id !== product.id) : old,
      );

      return { prevListings, prevProducts };
    },

    mutationFn: async (product) => {
      // Soft delete: set deleted_at + status HIDDEN
      const { error } = await supabase
        .from('products')
        .update({
          deleted_at: new Date().toISOString(),
          status: 'HIDDEN',
        })
        .eq('id', product.id);

      if (error) throw error;
    },

    onError: (error, _product, ctx) => {
      // Restore caches on error (guard errors don't reach here, but network errors do)
      if (ctx) {
        queryClient.setQueryData(['my-listings'], ctx.prevListings);
        queryClient.setQueryData(['products'], ctx.prevProducts);
      }

      // Only show network error toast — guard errors already toasted above
      if (
        error.message !== 'FORBIDDEN_NOT_OWNER' &&
        error.message !== 'BLOCKED_STATUS' &&
        error.message !== 'BLOCKED_DISPUTE'
      ) {
        Toast.show({
          type: 'error',
          text1: t('common:errors.errorTitle', 'Error'),
          text2:
            error.message ||
            t('common:errors.generic', 'Ocurrió un error inesperado.'),
        });
      }
    },

    onSuccess: () => {
      // Haptic feedback on iOS only
      if (Platform.OS === 'ios' && Haptics) {
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // Silently ignore haptics errors
        }
      }

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

      queryClient.invalidateQueries({ queryKey: ['my-listings'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return {
    deleteProduct: deleteMutation.mutate,
    deletingProductId: deleteMutation.isPending
      ? ((deleteMutation.variables as Product | undefined)?.id ?? null)
      : null,
    isDeleting: deleteMutation.isPending,
  };
};
