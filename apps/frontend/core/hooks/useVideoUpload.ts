import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../db/supabase';

const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50MB (Límite Supabase Free)
const MAX_VIDEO_DURATION_MS = 120000; // 2 Minutos

export const useVideoUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [status, requestPermission] = ImagePicker.useMediaLibraryPermissions();

  const pickVideo = async () => {
    try {
      const hasPermission =
        status?.granted || (await requestPermission()).granted;
      if (!hasPermission) {
        Alert.alert('Permiso denegado', 'Necesitamos acceso a tus videos.');
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
        Alert.alert(
          'Video muy largo',
          'El video no debe superar los 2 minutos. Por favor, recórtalo.',
        );
        return null;
      }

      // 2. Validación de Tamaño (Evitar Error 413 de Supabase)
      if (asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE_BYTES) {
        Alert.alert(
          'Archivo muy pesado',
          'El video supera los 50MB. Intenta grabar en una resolución menor.',
        );
        return null;
      }

      return asset;
    } catch (error) {
      console.error('[Picker Error]', error);
      Alert.alert('Error', 'No se pudo abrir el selector de video.');
      return null;
    }
  };

  const uploadVideo = async (orderId: string, userId: string, uri: string) => {
    if (!orderId || !userId)
      throw new Error('Faltan parámetros de identificación (Order/User)');

    setUploading(true);
    try {
      console.log('[Video Upload] URI:', uri);

      // 1. Obtenemos el Blob nativo directo del archivo físico (sin Base64 ni ArrayBuffers)
      const response = await fetch(uri);
      const blob = await response.blob();

      console.log('[Video Upload] Native Blob size (bytes):', blob.size);

      const fileName = `unboxing_${Date.now()}.mp4`;
      const path = `disputes/${orderId}/${userId}/${fileName}`;
      console.log('[Video Upload] Uploading directly to path:', path);

      // 2. Le pasamos el 'blob' crudo al SDK de Supabase
      const { error } = await supabase.storage
        .from('evidence')
        .upload(path, blob, {
          contentType: 'video/mp4',
          upsert: true,
        });

      if (error) {
        console.error('[Video Upload] Supabase error:', error);
        throw error;
      }

      const { data: urlData } = supabase.storage
        .from('evidence')
        .getPublicUrl(path);
      console.log('[Video Upload] Success, URL:', urlData.publicUrl);
      return urlData.publicUrl;
    } catch (error: any) {
      console.error('[Video Upload Error]', error.message, error);
      throw error;
    } finally {
      setUploading(false);
    }
  };

  return { pickVideo, uploadVideo, uploading };
};
