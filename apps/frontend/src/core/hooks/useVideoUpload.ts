import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { supabase } from '../db/supabase';
import { resolveMediaType, uploadMediaFromUri } from '../storage/uploadMedia';

const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50MB (Límite Supabase Free)
const MAX_VIDEO_DURATION_MS = 120000; // 2 Minutos

export const useVideoUpload = () => {
  const { t } = useTranslation('disputes');
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [status, requestPermission] = ImagePicker.useMediaLibraryPermissions();

  const pickVideo = async () => {
    try {
      const hasPermission =
        status?.granted || (await requestPermission()).granted;
      if (!hasPermission) {
        Alert.alert(
          t('video.permissionDeniedTitle'),
          t('video.permissionDeniedMsg'),
        );
        return null;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true, // Permite al usuario recortar si se pasó de los 2 min
        videoExportPreset: ImagePicker.VideoExportPreset.H264_640x480, // Calidad optimizada
        allowsMultipleSelection: false,
      });

      if (result.canceled || !result.assets) return null;

      const asset = result.assets[0];

      // 1. Validación de Duración
      if (asset.duration && asset.duration > MAX_VIDEO_DURATION_MS) {
        Alert.alert(t('video.tooLongTitle'), t('video.tooLongMsg'));
        return null;
      }

      // 2. Validación de Tamaño (Evitar Error 413 de Supabase)
      if (asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE_BYTES) {
        Alert.alert(t('video.tooLargeTitle'), t('video.tooLargeMsg'));
        return null;
      }

      return asset;
    } catch (error) {
      console.error('[Picker Error]', error);
      Alert.alert(t('video.pickerErrorTitle'), t('video.pickerErrorMsg'));
      return null;
    }
  };

  const uploadVideo = async (orderId: string, userId: string, uri: string) => {
    if (!orderId || !userId) throw new Error('VIDEO_MISSING_IDS');
    if (uploadingRef.current) throw new Error('VIDEO_UPLOAD_IN_PROGRESS');

    uploadingRef.current = true;
    setUploading(true);
    try {
      const { ext, contentType } = resolveMediaType(uri);
      const path = `disputes/${orderId}/${userId}/unboxing_${Date.now()}.${ext}`;

      // The picker can omit fileSize, so the limit is enforced on the real bytes.
      await uploadMediaFromUri({
        storage: supabase.storage,
        bucket: 'evidence',
        path,
        uri,
        contentType,
        upsert: true,
        maxBytes: MAX_VIDEO_SIZE_BYTES,
      });

      const { data: urlData } = supabase.storage
        .from('evidence')
        .getPublicUrl(path);
      return urlData.publicUrl;
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  return { pickVideo, uploadVideo, uploading };
};
