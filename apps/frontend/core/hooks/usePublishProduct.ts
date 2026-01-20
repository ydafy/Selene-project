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
  const { draft } = useSellStore();
  const { session } = useAuthContext();
  const queryClient = useQueryClient();

  /**
   * Sube una imagen a Supabase si es local.
   * Si ya es una URL remota (edición), la devuelve tal cual.
   */
  const uploadImage = async (uri: string, userId: string) => {
    // Optimización: Si ya está en la nube, no hacemos nada
    if (uri.startsWith('http')) return uri;

    try {
      console.log(`[Upload] Iniciando subida para: ${uri}`);
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();

      const fileExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(fileName, arrayBuffer, {
          contentType: `image/${fileExt}`,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('products').getPublicUrl(fileName);
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
    const isEditMode = !!draft.id;
    console.log(
      `[Publish] Iniciando ${isEditMode ? 'EDICIÓN' : 'CREACIÓN'}...`,
    );

    try {
      // 1. Calcular Aspect Ratio (Solo si la portada es nueva/local)
      const coverUri = draft.images[0];
      let aspectRatio = 1;

      if (!coverUri.startsWith('http')) {
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
      } else {
        // Si es edición y no cambió la portada, podríamos mantener el ratio anterior,
        // pero por seguridad recalculamos o usamos 1 si no tenemos acceso fácil al anterior aquí.
        // (Idealmente el draft debería tener el aspect_ratio original cargado, pero para MVP esto basta).
      }

      // 2. Procesar Imágenes (Subir nuevas, mantener viejas)
      const uploadedUrls = await Promise.all(
        draft.images.map((uri) => uploadImage(uri, session.user.id)),
      );

      // 3. Preparar Payload Base
      const productData = {
        name: draft.name,
        description: draft.description,
        price: parseFloat(draft.price),
        category: draft.category as ProductCategory,
        condition: draft.condition,
        usage: draft.usage,
        images: uploadedUrls,
        specifications: draft.specifications,
        // Solo actualizamos ratio si calculamos uno nuevo (es decir, si subimos foto nueva)
        ...(aspectRatio !== 1 ? { aspect_ratio: aspectRatio } : {}),
      };

      let resultData;

      if (isEditMode) {
        // --- LÓGICA DE EDICIÓN (UPDATE) ---

        // Recuperamos el estado original para comparar
        const original = useSellStore.getState().originalData;

        // REGLAS DE NEGOCIO: ¿Qué cambios requieren re-verificación?
        const sacredChanges =
          JSON.stringify(productData.images) !==
            JSON.stringify(original?.images) ||
          JSON.stringify(productData.specifications) !==
            JSON.stringify(original?.specifications) ||
          productData.category !== original?.category;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatePayload: any = {
          ...productData,
          rejection_reason: null, // Siempre limpiamos el mensaje de rechazo al editar
        };

        if (sacredChanges) {
          // Si tocó algo sagrado (Fotos, Specs, Categoría) -> Castigo: Volver a verificar
          updatePayload.status = 'PENDING_VERIFICATION';
          console.log(
            '[Publish] Cambios sagrados detectados. Status -> PENDING',
          );
        } else {
          // Si solo tocó cosméticos (Título, Precio) -> Mantenemos status actual
          // NO enviamos el campo 'status', Supabase respeta el valor actual.
          console.log('[Publish] Cambios cosméticos. Status mantenido.');
        }

        const { data, error } = await supabase
          .from('products')
          .update(updatePayload)
          .eq('id', draft.id)
          .select()
          .single();

        if (error) throw error;
        resultData = data;
      } else {
        // --- LÓGICA DE CREACIÓN (INSERT) ---
        const { data, error } = await supabase
          .from('products')
          .insert({
            ...productData,
            seller_id: session.user.id,
            status: 'PENDING_VERIFICATION',
            views: 0,
            aspect_ratio: aspectRatio,
          })
          .select()
          .single();

        if (error) throw error;
        resultData = data;
      }

      console.log(`[Publish] ¡Éxito! ID: ${resultData.id}`);

      // 4. Invalidación de Caché
      await queryClient.invalidateQueries({ queryKey: ['my-listings'] });
      if (isEditMode) {
        // Si editamos, invalidamos también la vista de detalle de ese producto específico
        await queryClient.invalidateQueries({
          queryKey: ['product', resultData.id],
        });
      }

      // 5. Navegación a Éxito
      router.replace({
        pathname: '/sell/success',
        params: { productId: resultData.id },
      });

      // 6. Limpieza diferida
    } catch (error) {
      console.error('[Publish Failed]', error);
      Alert.alert('Error', 'Hubo un problema al guardar. Revisa tu conexión.');
    } finally {
      setIsPublishing(false);
    }
  };

  return { publish, isPublishing };
};
