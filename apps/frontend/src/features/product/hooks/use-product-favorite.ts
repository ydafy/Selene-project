import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../shared/lib/supabase';
import { useAuthContext } from '../../../shared/lib/auth/auth-provider';

/** Offers the push pre-prompt; the route passes it so this feature imports no other. */
export type OfferFavoritePush = (moment: 'favorite') => Promise<void>;

export const useProductFavorite = (
  productId: string,
  offerPushPermission: OfferFavoritePush,
) => {
  const { session } = useAuthContext();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  //  ¿Es favorito? (Filtrando por integridad del producto)
  const { data: isFavorite, isLoading } = useQuery({
    queryKey: ['favorite', productId, userId],
    queryFn: async () => {
      if (!userId || !productId) return false;

      const { data, error } = await supabase
        .from('favorites')
        .select('id')
        .eq('product_id', productId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    },
    enabled: !!userId && !!productId,
  });

  //  Toggle con validación de "Vida" del producto
  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('AUTH_REQUIRED');

      if (isFavorite) {
        // DELETE FÍSICO: Los favoritos no necesitan soft delete,
        // son solo una relación muchos-a-muchos.
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('product_id', productId)
          .eq('user_id', userId);
        if (error) throw error;
        return 'removed';
      } else {
        //  ¿El producto sigue existiendo?
        const { data: product, error: checkError } = await supabase
          .from('products_public')
          .select('id')
          .eq('id', productId)
          .single();

        if (checkError || !product) throw new Error('PRODUCT_NOT_AVAILABLE');

        const { error } = await supabase
          .from('favorites')
          .insert({ product_id: productId, user_id: userId });
        if (error) throw error;
        return 'added';
      }
    },
    onSuccess: (result) => {
      if (result === 'added') void offerPushPermission('favorite');
    },
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: ['favorite', productId, userId],
      });
      const previousValue = queryClient.getQueryData([
        'favorite',
        productId,
        userId,
      ]);
      queryClient.setQueryData(
        ['favorite', productId, userId],
        (old: boolean) => !old,
      );
      return { previousValue };
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(
        ['favorite', productId, userId],
        context?.previousValue,
      );
      console.error('[FAVORITES] Error toggling:', err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['favorite', productId, userId],
      });
      queryClient.invalidateQueries({ queryKey: ['my-favorites'] });
      queryClient.invalidateQueries({ queryKey: ['all-favorites'] });
    },
  });

  return {
    isFavorite: !!isFavorite,
    isLoading,
    toggleFavorite: mutation.mutate,
    toggleFavoriteAsync: mutation.mutateAsync,
  };
};
