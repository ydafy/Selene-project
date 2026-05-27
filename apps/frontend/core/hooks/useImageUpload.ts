/**
 * @file core/hooks/useImageUpload.ts
 * @description Hook genérico para captura (Cámara/Galería) y subida de imágenes a Supabase Storage.
 * Maneja permisos, compresión básica y subidas atómicas con soporte para Upsert.
 */

import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../db/supabase';
import { decode } from 'base64-arraybuffer';
import { useTranslation } from 'react-i18next';

interface PickerOptions {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
}

export const useImageUpload = () => {
  const { t } = useTranslation('common');
  const [uploading, setUploading] = useState(false);

  const [libraryStatus, requestLibraryPermission] =
    ImagePicker.useMediaLibraryPermissions();
  const [cameraStatus, requestCameraPermission] =
    ImagePicker.useCameraPermissions();

  const handleImageResult = (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets || result.assets.length === 0)
      return null;
    return result.assets[0];
  };

  /**
   * Abre la galería del dispositivo.
   */
  const pickImage = async (
    options: PickerOptions = {
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    },
  ) => {
    const hasPermission =
      libraryStatus?.granted || (await requestLibraryPermission()).granted;
    if (!hasPermission) {
      Alert.alert(
        t('permissions.deniedTitle', 'Permiso denegado'),
        t('permissions.libraryMsg', 'Necesitamos acceso a tus fotos.'),
      );
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      ...options,
    });

    return handleImageResult(result);
  };

  /**
   * Abre la cámara del dispositivo.
   */
  const takePhoto = async (
    options: PickerOptions = {
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    },
  ) => {
    const hasPermission =
      cameraStatus?.granted || (await requestCameraPermission()).granted;
    if (!hasPermission) {
      Alert.alert(
        t('permissions.deniedTitle', 'Permiso denegado'),
        t('permissions.cameraMsg', 'Necesitamos acceso a tu cámara.'),
      );
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      base64: true,
      ...options,
    });

    return handleImageResult(result);
  };

  /**
   * Sube un archivo base64 a un bucket específico de Supabase.
   */
  const uploadFile = async (
    bucket: 'Avatars' | 'evidence',
    path: string,
    base64Image: string,
    fileExtension: string = 'jpg',
  ) => {
    setUploading(true);
    try {
      const arrayBuffer = decode(base64Image);
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, arrayBuffer, {
          contentType: `image/${fileExtension}`,
          upsert: true, // Si el archivo existe, lo sobreescribe
        });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(path);

      // Cache-busting: Añadimos un timestamp a la URL para forzar a la UI a recargar la imagen
      return `${urlData.publicUrl}?t=${Date.now()}`;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      console.error(`[Upload Error - ${bucket}]`, message);
      throw error;
    } finally {
      setUploading(false);
    }
  };

  /**
   * Alias para subir avatares.
   * Usa un nombre fijo (avatar.ext) para aprovechar el upsert y ahorrar storage.
   */
  const uploadAvatar = (userId: string, base64: string, ext: string) =>
    uploadFile('Avatars', `${userId}/avatar.${ext}`, base64, ext);

  return { pickImage, takePhoto, uploadFile, uploadAvatar, uploading };
};
