import { useState, useCallback, useRef } from 'react';
import { Image, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useNetInfo } from '@react-native-community/netinfo';
import Toast from 'react-native-toast-message';

import { publishProductSchema } from '../schemas/sell.schema';

import { supabase } from '../db/supabase';
import {
  buildPublicationEconomicsSnapshot,
  useSellStore,
} from '../store/useSellStore';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { ProductCategory } from '@selene/types';
import { normalize } from '../utils/compare';
import { useTranslation } from 'react-i18next';
import {
  checkPublishGuard,
  buildInitialUploadProgress,
  ImageUploadState,
} from '../utils/publishGuard';

export const usePublishProduct = () => {
  const [isPublishing, setIsPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<
    Record<string, ImageUploadState>
  >({});
  const publishingLockRef = useRef(false);
  const router = useRouter();
  const draft = useSellStore((state) => state.draft);
  const resetDraft = useSellStore((state) => state.resetDraft);
  const setPublicationEconomics = useSellStore(
    (state) => state.setPublicationEconomics,
  );
  const { session } = useAuthContext();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['common', 'sell']);
  const { isConnected } = useNetInfo();

  const buildImageUploadState = (
    current: ImageUploadState | undefined,
    patch: Partial<ImageUploadState>,
  ): ImageUploadState => ({
    status: patch.status ?? current?.status ?? 'pending',
    progress: patch.progress ?? current?.progress ?? 0,
  });

  const setImageProgress = useCallback(
    (uri: string, patch: Partial<ImageUploadState>) => {
      setUploadProgress((prev) => ({
        ...prev,
        [uri]: buildImageUploadState(prev[uri], patch),
      }));
    },
    [],
  );

  const uploadImage = async (uri: string, userId: string) => {
    // Si ya es una URL remota (edición), no la subimos de nuevo
    if (uri.startsWith('http')) {
      setImageProgress(uri, { status: 'done', progress: 100 });
      return uri;
    }

    setImageProgress(uri, { status: 'uploading', progress: 0 });

    try {
      console.log(`[Upload] Iniciando subida para: ${uri}`);
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();

      const fileExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${userId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      const uploadOptions = {
        contentType: `image/${fileExt}`,
        upsert: false,
      };

      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(fileName, arrayBuffer, uploadOptions);

      if (uploadError) throw uploadError;

      setImageProgress(uri, { status: 'done', progress: 100 });
      const { data } = supabase.storage.from('products').getPublicUrl(fileName);
      return data.publicUrl;
    } catch (error) {
      setImageProgress(uri, { status: 'error', progress: 0 });
      console.error('[Upload Error]', error);
      throw error;
    }
  };

  const publish = async () => {
    const guard = checkPublishGuard({
      isPublishing,
      publishingLocked: publishingLockRef.current,
      isOffline: isConnected === false,
      hasImages: draft.images.length > 0,
      hasSession: !!session?.user.id,
    });

    if (guard.type === 'blocked') {
      if (guard.reason === 'no_session') {
        Alert.alert(t('common:states.errorTitle'), t('sell:errors.noSession'));
      }
      if (guard.reason === 'offline') {
        Alert.alert(t('common:states.errorTitle'), t('sell:errors.offline'));
      }
      return;
    }

    if (!session?.user.id) return;

    // --- PASO 0: VALIDACIÓN ESTRICTA CON ZOD (En memoria, 0 consumo de red) ---
    const validation = publishProductSchema.safeParse(draft);

    if (!validation.success) {
      // En Zod moderno, el array de errores se llama .issues
      const firstErrorMessage =
        validation.error.issues[0]?.message ||
        'Por favor revisa los campos del formulario.';

      Alert.alert(t('common:states.errorTitle'), firstErrorMessage);
      return; // ⛔️ FRENAMOS ACÁ: 0 consumo de almacenamiento
    }

    // --- PASO 1: CONTINÚA EL FLUJO SEGURO ---
    publishingLockRef.current = true;
    setIsPublishing(true);

    const uris = draft.images;
    setUploadProgress(buildInitialUploadProgress(uris));

    const isEditMode = !!draft.id;

    let requiresReverification = false;

    try {
      let publicationEconomics = draft.publicationEconomics;
      if (!isEditMode && !publicationEconomics) {
        const { data: settings, error: settingsError } = await supabase
          .from('system_settings')
          .select('service_fee_pct, shipping_buffer_cents, insurance_rate')
          .eq('id', 1)
          .single();

        if (settingsError || !settings) {
          throw new Error('PUBLICATION_ECONOMICS_ACCEPTANCE_REQUIRED');
        }

        publicationEconomics = buildPublicationEconomicsSnapshot({
          priceCents: Math.round(parseFloat(draft.price) * 100),
          quoteCents: Math.round(parseFloat(draft.shipping_cost) * 100),
          settings,
        });
        setPublicationEconomics(publicationEconomics);
      }

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
        uris.map((uri) => uploadImage(uri, session.user.id)),
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
        specifications: draft.specifications as Record<string, string>,

        // --- DATOS DE ENVÍO (CRÍTICOS) ---
        shipping_cost: parseFloat(draft.shipping_cost || '0'),
        shipping_payer: draft.shipping_payer,
        origin_zip: draft.origin_zip,
        package_preset: draft.package_preset,

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
        } else {
          requiresReverification = false;
        }
        if (!draft.id)
          throw new Error('ID de producto no encontrado para actualizar');
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
        if (!publicationEconomics) {
          throw new Error('PUBLICATION_ECONOMICS_ACCEPTANCE_REQUIRED');
        }
        const { data, error } = await supabase
          .from('products')
          .insert(
            {
              ...productData,
              publication_shipping_reserve_cents:
                publicationEconomics.shippingReserveCents,
              publication_commission_rate: publicationEconomics.commissionRate,
              publication_insurance_rate: publicationEconomics.insuranceRate,
              seller_id: session.user.id,
              status: 'PENDING_VERIFICATION',
              views: 0,
              aspect_ratio: aspectRatio,
            } as never,
          )
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
          text1: t('common:states.updateMessage'),
          text2: t('common:successChange'),
          position: 'top',
        });
      }

      // 6. Limpieza (Solo si no vamos a Success, porque Success limpia al salir)
      if (!requiresReverification) {
        resetDraft();
      }
    } catch (error) {
      console.error('[Publish Failed]', error);
      Alert.alert(
        t('common:states.errorTitle'),
        t('sell:errors.publishFailed'),
      );
    } finally {
      publishingLockRef.current = false;
      setIsPublishing(false);
    }
  };

  return {
    publish,
    isPublishing,
    uploadProgress,
    isOffline: isConnected === false,
  };
};
