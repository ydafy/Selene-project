import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import Toast from 'react-native-toast-message';

export const useProductManagement = () => {
  const queryClient = useQueryClient();

  // Mutación para borrar producto
  const deleteMutation = useMutation({
    mutationFn: async (productId: string) => {
      // 1. Borrar de la base de datos
      // (Las imágenes en Storage se quedarán huérfanas por ahora,
      // para un MVP está bien, luego podemos hacer una Edge Function que limpie)
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);

      if (error) throw error;
    },
    onSuccess: () => {
      // 2. Feedback visual
      Toast.show({
        type: 'success',
        text1: 'Producto eliminado',
        text2: 'Tu publicación ha sido borrada correctamente.',
      });

      // 3. Actualizar listas automáticamente
      queryClient.invalidateQueries({ queryKey: ['my-listings'] }); // Actualiza "Mis Publicaciones"
      queryClient.invalidateQueries({ queryKey: ['products'] }); // Actualiza el Home
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      Toast.show({
        type: 'error',
        text1: 'Error al eliminar',
        text2: error.message || 'Inténtalo de nuevo más tarde.',
      });
    },
  });

  return {
    deleteProduct: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
};
