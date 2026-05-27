import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert } from 'react-native';

export const useShareLabel = () => {
  const [isSharing, setIsSharing] = useState(false);

  const shareLabel = async (pdfUrl: string, orderId: string) => {
    if (!pdfUrl) return;

    setIsSharing(true);
    try {
      const fileName = `Guia_Selene_${orderId.slice(0, 8)}.pdf`;

      // Acceso seguro para evitar el error de "Property does not exist"
      const fs: any = FileSystem;
      const directory = fs.cacheDirectory || fs.documentDirectory;
      const fileUri = `${directory}${fileName}`;

      // Pattern compatible con SDK 51/52
      const downloadRes = await FileSystem.downloadAsync(pdfUrl, fileUri);

      if (downloadRes.status !== 200) throw new Error('Download failed');

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(downloadRes.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Guía de Envío Selene',
        });
      } else {
        Alert.alert('Error', 'Tu dispositivo no soporta compartir archivos.');
      }
    } catch (error) {
      console.error('Error sharing label:', error);
      Alert.alert('Error', 'No se pudo procesar la guía PDF.');
    } finally {
      setIsSharing(false);
    }
  };

  return { shareLabel, isSharing };
};
