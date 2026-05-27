import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../db/supabase';
import { Profile } from '@selene/types';
import { useImageUpload } from './useImageUpload';

// 1. Hook de Lectura (Actualizado para usar el tipo global)
export const useProfile = (userId: string) => {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*') // Traemos todo lo definido en tu interfaz de types
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data as Profile;
    },
    enabled: !!userId,
  });
};

// 2. Hook de Mutación (MVP++: Toda la lógica de subida vive aquí)
export const useUpdateAvatar = () => {
  const queryClient = useQueryClient();
  const { uploadAvatar } = useImageUpload();

  return useMutation({
    mutationFn: async ({
      userId,
      base64,
      ext,
    }: {
      userId: string;
      base64: string;
      ext: string;
    }) => {
      // A. Subir imagen al bucket
      const publicUrl = await uploadAvatar(userId, base64, ext);
      if (!publicUrl) throw new Error('No se pudo obtener la URL pública');

      // B. Actualizar tabla profiles
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (error) throw error;
      return publicUrl;
    },
    onSuccess: (_, variables) => {
      // C. Invalidar caché para refrescar la UI automáticamente
      queryClient.invalidateQueries({
        queryKey: ['profile', variables.userId],
      });
    },
  });
};
