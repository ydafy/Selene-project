import { useState } from 'react';
import { Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import { supabase } from '../db/supabase';
import { useSellStore } from '../store/useSellStore';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { ProductCategory } from '@selene/types';
import { normalize } from '../utils/compare';
import { useTranslation } from 'react-i18next';

export const usePublishProduct = () => {
  const [isPublishing, setIsPublishing] = useState(false);
  const router = useRouter();
  const { draft, resetDraft } = useSellStore();
  const { session } = useAuthContext();
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');

  const uploadImage = async (uri: string, userId: string) => {
    // Si ya es una URL remota (edición), no la subimos de nuevo
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

    let requiresReverification = false;

    try {
      // 1. Calcular Aspect Ratio
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
            () => resolve(),
          );
        });
      }

      // 2. Subir Imágenes
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

        // --- DATOS DE ENVÍO (CRÍTICOS) ---
        shipping_cost: parseFloat(draft.shipping_cost || '0'),
        shipping_payer: draft.shipping_payer,
        origin_zip: draft.origin_zip, // <--- ESTE FALTABA
        package_preset: draft.package_preset, // <--- ESTE FALTABA

        ...(aspectRatio !== 1 ? { aspect_ratio: aspectRatio } : {}),
      };

      let resultData;

      if (isEditMode) {
        // --- LÓGICA DE EDICIÓN ---
        const original = useSellStore.getState().originalData;

        const sacredChanges =
          JSON.stringify(normalize(productData.images)) !==
            JSON.stringify(normalize(original?.images)) ||
          JSON.stringify(normalize(productData.specifications)) !==
            JSON.stringify(normalize(original?.specifications)) ||
          productData.category !== original?.category;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatePayload: any = {
          ...productData,
          rejection_reason: null,
        };

        if (sacredChanges) {
          updatePayload.status = 'PENDING_VERIFICATION';
          requiresReverification = true;
          console.log('[Publish] Cambios sagrados. Status -> PENDING');
        } else {
          console.log('[Publish] Cambios cosméticos. Status mantenido.');
          requiresReverification = false;
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
        // --- LÓGICA DE CREACIÓN ---
        requiresReverification = true;
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

      // 4. Invalidación de Caché
      await queryClient.invalidateQueries({ queryKey: ['my-listings'] });
      if (isEditMode) {
        await queryClient.invalidateQueries({
          queryKey: ['product', resultData.id],
        });
      }

      // 5. Navegación Inteligente
      if (requiresReverification) {
        router.replace({
          pathname: '/sell/success',
          params: { productId: resultData.id },
        });
      } else {
        // Edición segura -> Volver al perfil
        router.dismissAll();
        router.replace('/(tabs)/profile');
        Toast.show({
          type: 'success',
          text1: t('states.updateMessage') || 'Actualizado', // Fallback por si no tienes la clave
          text2: t('successChange') || 'Los cambios se han guardado.',
          position: 'top',
        });
      }

      // 6. Limpieza (Solo si no vamos a Success, porque Success limpia al salir)
      if (!requiresReverification) {
        resetDraft();
      }
    } catch (error) {
      console.error('[Publish Failed]', error);
      Alert.alert('Error', 'Hubo un problema al guardar.');
    } finally {
      setIsPublishing(false);
    }
  };

  return { publish, isPublishing };
};
