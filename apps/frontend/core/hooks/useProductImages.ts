import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

export const useProductImages = () => {
  const { t } = useTranslation('sell');
  const [loading, setLoading] = useState(false);

  const [libraryStatus, requestLibraryPermission] =
    ImagePicker.useMediaLibraryPermissions();
  const [cameraStatus, requestCameraPermission] =
    ImagePicker.useCameraPermissions();

  // Función genérica para procesar resultados
  const processResult = (result: ImagePicker.ImagePickerResult): string[] => {
    if (result.canceled || !result.assets) return [];
    return result.assets.map((asset) => asset.uri);
  };

  const pickImages = async (maxAllowed: number) => {
    const hasPermission =
      libraryStatus?.granted || (await requestLibraryPermission()).granted;

    if (!hasPermission) {
      Alert.alert(t('errors.permissionDenied'), t('errors.permissionMessage'));
      return [];
    }

    setLoading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: maxAllowed,
        quality: 0.6, // BAJAMOS DE 0.7 A 0.6 (Suficiente para pantallas retina)
        allowsEditing: false,
        // AGREGAMOS ESTO:
        presentationStyle:
          ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
        exif: false, // No necesitamos metadatos GPS (Privacidad + Ahorro)
      });

      return processResult(result);
    } catch (error) {
      console.error('Error picking images:', error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const takePhoto = async () => {
    const hasPermission =
      cameraStatus?.granted || (await requestCameraPermission()).granted;

    if (!hasPermission) {
      Alert.alert(t('errors.permissionDenied'), t('errors.permissionMessage'));
      return null;
    }

    setLoading(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.6, // Optimización
        exif: false,
      });

      const uris = processResult(result);
      return uris.length > 0 ? uris[0] : null;
    } catch (error) {
      console.error('Error taking photo:', error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    pickImages,
    takePhoto,
    loading,
  };
};
