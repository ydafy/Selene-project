import React, { useState } from 'react';
import { TouchableOpacity, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ImageViewing from 'react-native-image-viewing';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';
import {
  buildAddPhotosA11yLabel,
  buildCloseViewerA11yLabel,
  buildCoverBadgeA11yLabel,
  buildMovePhotoDownA11yLabel,
  buildMovePhotoUpA11yLabel,
  buildPhotoCounterA11yLabel,
  buildRemovePhotoA11yLabel,
} from './imageGridA11y';

const MAX_IMAGES = 5;

type ImageGridPickerProps = {
  images: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onReorder?: (index: number, direction: 'left' | 'right') => void;
};

export const ImageGridPicker = ({
  images,
  onAdd,
  onRemove,
  onReorder,
}: ImageGridPickerProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('sell');
  const { width: screenWidth } = useWindowDimensions();

  // Cálculo reactivo del tamaño de celda (2 columnas)
  const itemSize = (screenWidth - 48) / 3;

  const [visible, setVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const canAddMore = images.length < MAX_IMAGES;
  const imagesForViewer = images.map((uri) => ({ uri }));

  const openViewer = (index: number) => {
    setCurrentImageIndex(index);
    setVisible(true);
  };

  return (
    <Box>
      {/* Visor de Pantalla Completa */}
      <ImageViewing
        images={imagesForViewer}
        imageIndex={currentImageIndex}
        visible={visible}
        onRequestClose={() => setVisible(false)}
        swipeToCloseEnabled={true}
        doubleTapToZoomEnabled={true}
        animationType="fade"
        backgroundColor="#000000"
        HeaderComponent={() => (
          <Box position="absolute" top={50} right={20} zIndex={1}>
            <TouchableOpacity
              onPress={() => setVisible(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={buildCloseViewerA11yLabel(t)}
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

      {/* Grid de Imágenes */}
      <Box flexDirection="row" flexWrap="wrap" gap="s">
        {images.map((uri, index) => (
          <Box
            key={uri}
            width={itemSize}
            height={itemSize}
            borderRadius="m"
            overflow="hidden"
            backgroundColor="cardBackground"
            position="relative"
          >
            <TouchableOpacity
              onPress={() => openViewer(index)}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={buildPhotoCounterA11yLabel(
                index + 1,
                images.length,
                t,
              )}
              style={{ flex: 1 }}
            >
              <AppImage
                source={{ uri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            </TouchableOpacity>

            {/* Botón Eliminar con hitSlop generoso para dedos */}
            <TouchableOpacity
              onPress={() => onRemove(index)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={buildRemovePhotoA11yLabel(index + 1, t)}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                backgroundColor: 'rgba(0,0,0,0.6)',
                borderRadius: 12,
                padding: 4,
                zIndex: 10,
              }}
            >
              <MaterialCommunityIcons name="close" size={14} color="white" />
            </TouchableOpacity>

            {/* Botones de Reordenamiento */}
            {onReorder && images.length > 1 && (
              <Box
                position="absolute"
                bottom={4}
                right={4}
                flexDirection="row"
                gap="xs"
                zIndex={10}
              >
                <TouchableOpacity
                  onPress={() => onReorder(index, 'left')}
                  disabled={index === 0}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={buildMovePhotoUpA11yLabel(index + 1, t)}
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    borderRadius: 12,
                    padding: 4,
                    opacity: index === 0 ? 0.4 : 1,
                  }}
                >
                  <MaterialCommunityIcons
                    name="chevron-left"
                    size={14}
                    color="white"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onReorder(index, 'right')}
                  disabled={index === images.length - 1}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel={buildMovePhotoDownA11yLabel(index + 1, t)}
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    borderRadius: 12,
                    padding: 4,
                    opacity: index === images.length - 1 ? 0.4 : 1,
                  }}
                >
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={14}
                    color="white"
                  />
                </TouchableOpacity>
              </Box>
            )}

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
                pointerEvents="none"
                accessible={true}
                accessibilityLabel={buildCoverBadgeA11yLabel(t)}
              >
                <Text
                  variant="caption-md"
                  color="background"
                  fontWeight="bold"
                  fontSize={10}
                >
                  {t('a11y.coverBadge')}
                </Text>
              </Box>
            )}
          </Box>
        ))}

        {/* Botón Agregar */}
        {canAddMore && (
          <TouchableOpacity
            onPress={onAdd}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={buildAddPhotosA11yLabel(t)}
          >
            <Box
              width={itemSize}
              height={itemSize}
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
