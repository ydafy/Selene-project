import { useState } from 'react';
import { Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '../db/supabase';
import { useSellStore } from '../store/useSellStore';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { ProductCategory } from '@selene/types';

export const usePublishProduct = () => {
  const [isPublishing, setIsPublishing] = useState(false);
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { draft, resetDraft } = useSellStore();
  const { session } = useAuthContext();

  // Hook para manipular el caché global
  const queryClient = useQueryClient();

  // Función auxiliar optimizada (fetch arrayBuffer)
  const uploadImage = async (uri: string, userId: string) => {
    try {
      console.log(`[Upload] Iniciando subida para: ${uri}`);
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();

      const fileExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Subimos a bucket 'products'
      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(fileName, arrayBuffer, {
          contentType: `image/${fileExt}`,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Obtenemos URL Pública
      const { data } = supabase.storage.from('products').getPublicUrl(fileName);
      console.log(`[Upload] Éxito. URL: ${data.publicUrl}`);
      return data.publicUrl;
    } catch (error) {
      console.error('[Upload Error]', error);
      throw error;
    }
  };

  const publish = async () => {
    if (!session?.user.id) {
      Alert.alert('Error', 'No hay sesión de usuario activa.');
      return;
    }
    if (draft.images.length === 0) return;

    setIsPublishing(true);
    console.log('[Publish] Iniciando proceso de publicación...');

    try {
      // 1. Calcular Aspect Ratio
      const coverUri = draft.images[0];
      let aspectRatio = 1;

      await new Promise<void>((resolve) => {
        Image.getSize(
          coverUri,
          (width, height) => {
            aspectRatio = width / height;
            resolve();
          },
          () => {
            console.warn(
              '[Publish] No se pudo calcular aspect ratio, usando default 1',
            );
            resolve();
          },
        );
      });

      // 2. Subir Imágenes
      console.log('[Publish] Subiendo imágenes...');
      const uploadedUrls = await Promise.all(
        draft.images.map((uri) => uploadImage(uri, session.user.id)),
      );

      // 3. Insertar en Base de Datos
      console.log('[Publish] Insertando en base de datos...');
      const { data, error: insertError } = await supabase
        .from('products')
        .insert({
          name: draft.name,
          description: draft.description,
          price: parseFloat(draft.price),
          category: draft.category as ProductCategory,
          condition: draft.condition,
          usage: draft.usage,
          images: uploadedUrls,
          status: 'PENDING_VERIFICATION',
          seller_id: session.user.id,
          specifications: draft.specifications,
          views: 0,
          aspect_ratio: aspectRatio,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      if (!data) throw new Error('No se recibió el ID del producto creado');

      console.log('[Publish] ¡Éxito! Producto ID:', data.id);

      // 4. Invalidación de Caché (Vital para el perfil)
      await queryClient.invalidateQueries({ queryKey: ['my-listings'] });

      // 5. NAVEGACIÓN SEGURA (Prioridad 1)
      // Usamos replace con objeto para cumplir con TypeScript estricto
      router.replace({
        pathname: '/sell/success',
        params: { productId: data.id },
      });
    } catch (error) {
      console.error('[Publish Failed]', error);
      Alert.alert('Error', 'Hubo un problema al publicar. Revisa tu conexión.');
    } finally {
      setIsPublishing(false);
    }
  };

  return { publish, isPublishing };
};
