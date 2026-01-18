import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../db/supabase';
import { decode } from 'base64-arraybuffer';

export const useImageUpload = () => {
  const [uploading, setUploading] = useState(false);

  // Hooks de permisos (Galería y Cámara)
  const [libraryStatus, requestLibraryPermission] =
    ImagePicker.useMediaLibraryPermissions();
  const [cameraStatus, requestCameraPermission] =
    ImagePicker.useCameraPermissions();

  // Función auxiliar para procesar el resultado
  const handleImageResult = (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }
    return result.assets[0];
  };

  // Opción A: Galería
  const pickImage = async () => {
    const hasPermission =
      libraryStatus?.granted || (await requestLibraryPermission()).granted;

    if (!hasPermission) {
      Alert.alert('Permiso denegado', 'Necesitamos acceso a tus fotos.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], // Sintaxis moderna
      allowsEditing: true, // Crop nativo (Esencial para avatares)
      aspect: [1, 1], // Cuadrado perfecto
      quality: 0.5, // Compresión
      base64: true,
    });

    return handleImageResult(result);
  };

  // Opción B: Cámara (NUEVO)
  const takePhoto = async () => {
    const hasPermission =
      cameraStatus?.granted || (await requestCameraPermission()).granted;

    if (!hasPermission) {
      Alert.alert('Permiso denegado', 'Necesitamos acceso a tu cámara.');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true, // Permite recortar la foto justo después de tomarla
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });

    return handleImageResult(result);
  };

  const uploadAvatar = async (
    userId: string,
    base64Image: string,
    fileExtension: string = 'jpg',
  ) => {
    // ... (Esta función se queda IGUAL que antes) ...
    setUploading(true);
    try {
      const fileName = `${userId}/${Date.now()}.${fileExtension}`;
      const arrayBuffer = decode(base64Image);

      const { error } = await supabase.storage
        .from('Avatars') // Recuerda usar tu nombre de bucket correcto (Avatars)
        .upload(fileName, arrayBuffer, {
          contentType: `image/${fileExtension}`,
          upsert: true,
        });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('Avatars')
        .getPublicUrl(fileName);

      return urlData.publicUrl;
    } catch (error) {
      throw error;
    } finally {
      setUploading(false);
    }
  };

  // Exportamos ambas funciones
  return { pickImage, takePhoto, uploadAvatar, uploading };
};
