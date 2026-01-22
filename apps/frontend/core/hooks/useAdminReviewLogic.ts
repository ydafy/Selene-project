import { useState, useEffect, useMemo } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query'; // <--- 1. IMPORTAR
import { supabase } from '../db/supabase';
import { Product } from '@selene/types';

export const useAdminReviewLogic = (id?: string) => {
  const router = useRouter();
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient(); // <--- 2. INICIALIZAR

  const [product, setProduct] = useState<Product | null>(null);
  const [proofUrls, setProofUrls] = useState<{
    physical?: string;
    performance?: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // 1. CARGAR DATOS
  useEffect(() => {
    const loadData = async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        Alert.alert('Error', t('alerts.errorLoad'));
        setLoading(false);
        return;
      }

      setProduct(data as Product);

      const vData = data.verification_data;
      if (vData) {
        const urls: { physical?: string; performance?: string } = {};
        if (vData.proof_physical) {
          const { data: signed } = await supabase.storage
            .from('verification')
            .createSignedUrl(vData.proof_physical, 3600);
          if (signed) urls.physical = signed.signedUrl;
        }
        if (vData.proof_performance) {
          const { data: signed } = await supabase.storage
            .from('verification')
            .createSignedUrl(vData.proof_performance, 3600);
          if (signed) urls.performance = signed.signedUrl;
        }
        setProofUrls(urls);
      }
      setLoading(false);
    };
    loadData();
  }, [id]);

  // 2. LÓGICA DE VEREDICTO
  const executeVerdict = async (
    verdict: 'APPROVE' | 'REJECT' | 'APPROVE_NOTE',
    note?: string,
  ) => {
    if (!product || !id) return;

    setProcessing(true);
    try {
      const isRejection = verdict === 'REJECT';
      const isApproval = verdict === 'APPROVE' || verdict === 'APPROVE_NOTE';

      // A. Actualizar Producto
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: any = {
        status: isRejection ? 'REJECTED' : 'VERIFIED',
        rejection_reason: isRejection ? note : null,
      };

      const { error: prodError } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id);
      if (prodError) throw prodError;

      // B. Crear Notificación
      let notifTitle = '';
      let notifMessage = '';
      let notifType = 'info';

      if (verdict === 'REJECT') {
        notifTitle = t('notifications.rejectTitle');
        notifMessage = t('notifications.rejectMessage', {
          productName: product.name,
          note: note,
        });
        notifType = 'error';
      } else if (verdict === 'APPROVE_NOTE') {
        notifTitle = t('notifications.approveNoteTitle');
        notifMessage = t('notifications.approveNoteMessage', {
          productName: product.name,
          note: note,
        });
        notifType = 'warning';
      } else {
        notifTitle = t('notifications.approveTitle');
        notifMessage = t('notifications.approveMessage', {
          productName: product.name,
        });
        notifType = 'success';
      }

      if (product.seller_id) {
        await supabase.from('notifications').insert({
          user_id: product.seller_id,
          title: notifTitle,
          message: notifMessage,
          type: notifType,
          read: false,
          action_path: isRejection ? `/verify/${id}` : '/profile/listings',
        });
      }

      // 3. INVALIDACIÓN DE CACHÉ (LA SOLUCIÓN)
      // Esto fuerza a la lista de 'admin-products' a recargarse en cuanto vuelvas atrás.
      await queryClient.invalidateQueries({ queryKey: ['admin-products'] });

      Alert.alert(
        isApproval ? t('alerts.successTitle') : t('alerts.rejectTitle'),
        t('alerts.successBody'),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      console.error(error);
      Alert.alert('Error', t('alerts.errorUpdate'));
    } finally {
      setProcessing(false);
    }
  };

  const viewerImages = useMemo(() => {
    const imgs = [];
    if (proofUrls.physical) imgs.push({ uri: proofUrls.physical });
    if (proofUrls.performance) imgs.push({ uri: proofUrls.performance });
    return imgs;
  }, [proofUrls]);

  return {
    product,
    proofUrls,
    loading,
    processing,
    viewerImages,
    executeVerdict,
  };
};
