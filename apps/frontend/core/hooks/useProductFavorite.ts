import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { useAuthContext } from '../../components/auth/AuthProvider';

export const useProductFavorite = (productId: string) => {
  const { session } = useAuthContext();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  // 1. Query: ¿Es este producto favorito del usuario actual?
  const { data: isFavorite, isLoading } = useQuery({
    queryKey: ['favorite', productId, userId],
    queryFn: async () => {
      if (!userId) return false;

      const { data, error } = await supabase
        .from('favorites')
        .select('id')
        .eq('product_id', productId)
        .eq('user_id', userId)
        .maybeSingle(); // Devuelve null si no existe, en lugar de error

      if (error) throw error;
      return !!data; // Devuelve true si existe, false si no
    },
    enabled: !!userId, // Solo se ejecuta si hay usuario logueado
  });

  // 2. Mutation: Poner o Quitar favorito
  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('User not logged in');

      if (isFavorite) {
        // Si ya es favorito, lo borramos
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('product_id', productId)
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        // Si no es favorito, lo creamos
        const { error } = await supabase
          .from('favorites')
          .insert({ product_id: productId, user_id: userId });
        if (error) throw error;
      }
    },
    // Optimistic Update: Actualizamos la UI antes de que termine la red
    onMutate: async () => {
      // Cancelamos queries pendientes para que no sobrescriban nuestro cambio
      await queryClient.cancelQueries({
        queryKey: ['favorite', productId, userId],
      });

      // Guardamos el valor anterior por si hay error
      const previousValue = queryClient.getQueryData([
        'favorite',
        productId,
        userId,
      ]);

      // Actualizamos la caché manualmente (invertimos el valor actual)
      queryClient.setQueryData(
        ['favorite', productId, userId],
        (old: boolean) => !old,
      );

      return { previousValue };
    },
    // Si falla, revertimos al valor anterior
    onError: (err, newTodo, context) => {
      queryClient.setQueryData(
        ['favorite', productId, userId],
        context?.previousValue,
      );
      console.error('Error al cambiar favorito:', err);
    },
    // Al terminar (éxito o fallo), invalidamos para asegurar datos frescos
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['favorite', productId, userId],
      });
    },
  });

  return {
    isFavorite: !!isFavorite, // Aseguramos que sea booleano
    isLoading,
    toggleFavorite: mutation.mutate, // La función para llamar al hacer click
  };
};
