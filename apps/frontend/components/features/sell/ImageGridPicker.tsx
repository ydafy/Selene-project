import React, { useState } from 'react';
import { TouchableOpacity, Dimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ImageViewing from 'react-native-image-viewing';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';

const MAX_IMAGES = 5;
const SCREEN_WIDTH = Dimensions.get('window').width;
const ITEM_SIZE = (SCREEN_WIDTH - 48) / 3;

type ImageGridPickerProps = {
  images: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
};

export const ImageGridPicker = ({
  images,
  onAdd,
  onRemove,
}: ImageGridPickerProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('sell');

  // --- ESTADO DEL VISOR ---
  const [visible, setVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const canAddMore = images.length < MAX_IMAGES;

  // Preparamos las imágenes para la librería (requiere objetos {uri: string})
  const imagesForViewer = images.map((uri) => ({ uri }));

  const openViewer = (index: number) => {
    setCurrentImageIndex(index);
    setVisible(true);
  };

  return (
    <Box>
      {/* --- VISOR DE PANTALLA COMPLETA --- */}
      <ImageViewing
        images={imagesForViewer}
        imageIndex={currentImageIndex}
        visible={visible}
        onRequestClose={() => setVisible(false)}
        swipeToCloseEnabled={true}
        doubleTapToZoomEnabled={true}
        animationType="fade"
        backgroundColor="#000000" // Negro puro para mejor contraste
        // Header simple para cerrar
        HeaderComponent={() => (
          <Box position="absolute" top={50} right={20} zIndex={1}>
            <TouchableOpacity
              onPress={() => setVisible(false)}
              style={{
                backgroundColor: 'rgba(0,0,0,0.5)',
                padding: 8,
                borderRadius: 20,
              }}
            >
              <MaterialCommunityIcons name="close" size={24} color="white" />
            </TouchableOpacity>
          </Box>
        )}
        // Footer con contador (1/5)
        FooterComponent={({ imageIndex }) => (
          <Box position="absolute" bottom={40} width="100%" alignItems="center">
            <Text
              variant="body-md"
              color="textPrimary"
              style={{ textShadowColor: 'black', textShadowRadius: 5 }}
            >
              {imageIndex + 1} / {images.length}
            </Text>
          </Box>
        )}
      />

      {/* --- GRID DE IMÁGENES --- */}
      <Box flexDirection="row" flexWrap="wrap" gap="s">
        {images.map((uri, index) => (
          <Box
            key={uri}
            width={ITEM_SIZE}
            height={ITEM_SIZE}
            borderRadius="m"
            overflow="hidden"
            backgroundColor="cardBackground"
            position="relative"
          >
            {/*
                Hacemos la imagen tocable para abrir el visor.
                Usamos activeOpacity alto (0.9) para que no parpadee mucho al tocar.
            */}
            <TouchableOpacity
              onPress={() => openViewer(index)}
              activeOpacity={0.9}
              style={{ flex: 1 }}
            >
              <AppImage
                source={{ uri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            </TouchableOpacity>

            {/* Botón Eliminar (Z-Index superior para que funcione el toque) */}
            <TouchableOpacity
              onPress={() => onRemove(index)}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                backgroundColor: 'rgba(0,0,0,0.6)',
                borderRadius: 12,
                padding: 4, // Área de toque un poco más grande
                zIndex: 10,
              }}
            >
              <MaterialCommunityIcons name="close" size={14} color="white" />
            </TouchableOpacity>

            {/* Badge de Portada */}
            {index === 0 && (
              <Box
                position="absolute"
                bottom={0}
                left={0}
                right={0}
                backgroundColor="primary"
                paddingVertical="xs"
                alignItems="center"
                pointerEvents="none" // Para que no bloquee toques si fuera necesario
              >
                <Text
                  variant="caption-md"
                  color="background"
                  fontWeight="bold"
                  fontSize={10}
                >
                  PORTADA
                </Text>
              </Box>
            )}
          </Box>
        ))}

        {/* Botón Agregar */}
        {canAddMore && (
          <TouchableOpacity onPress={onAdd} activeOpacity={0.7}>
            <Box
              width={ITEM_SIZE}
              height={ITEM_SIZE}
              borderRadius="m"
              borderWidth={2}
              borderColor="textSecondary"
              borderStyle="dashed"
              justifyContent="center"
              alignItems="center"
              backgroundColor="transparent"
            >
              <MaterialCommunityIcons
                name="camera-plus-outline"
                size={32}
                color={theme.colors.textSecondary}
              />
              <Text variant="caption-md" marginTop="xs" textAlign="center">
                {images.length === 0
                  ? t('fields.addPhotos')
                  : `${images.length}/${MAX_IMAGES}`}
              </Text>
            </Box>
          </TouchableOpacity>
        )}
      </Box>

      {/* Mensaje de Ayuda */}
      <Box marginTop="m" flexDirection="row" alignItems="center" gap="s">
        <MaterialCommunityIcons
          name="information-outline"
          size={16}
          color={theme.colors.textSecondary}
        />
        <Text variant="caption-md" color="textSecondary" flex={1}>
          {t('fields.imagesTip')}
        </Text>
      </Box>
    </Box>
  );
};
