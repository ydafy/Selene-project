import { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { useTheme } from '@shopify/restyle';

import { Box } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { AppImageViewer } from '../../ui/AppImageViewer';
import { Theme } from '../../../core/theme';

type ProductImageGalleryProps = {
  images: string[];
  productId: string;
};

export const ProductImageGallery = ({
  images,
  productId,
}: ProductImageGalleryProps) => {
  const theme = useTheme<Theme>();
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isViewerVisible, setIsViewerVisible] = useState(false);

  const currentImage = images[selectedImageIndex];
  const imagesForViewer = images.map((img) => ({ uri: img }));

  return (
    <>
      <AppImageViewer
        images={imagesForViewer}
        initialIndex={selectedImageIndex}
        visible={isViewerVisible}
        onClose={() => setIsViewerVisible(false)}
      />

      {/* --- GALERÍA EN PANTALLA (Sin cambios) --- */}
      <Box
        height={450}
        marginHorizontal="m"
        marginBottom="m"
        borderRadius="l"
        overflow="hidden"
        position="relative"
        backgroundColor="cardBackground"
      >
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setIsViewerVisible(true)}
          style={{ width: '100%', height: '100%' }}
        >
          <AppImage
            source={{ uri: currentImage }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            sharedTransitionTag={
              selectedImageIndex === 0 ? `image-${productId}` : undefined
            }
          />
        </TouchableOpacity>

        <Box
          position="absolute"
          right={12}
          top={0}
          bottom={0}
          justifyContent="center"
          gap="s"
        >
          {images.map((img, index) => (
            <TouchableOpacity
              key={index}
              onPress={() => setSelectedImageIndex(index)}
              activeOpacity={0.8}
            >
              <Box
                height={50}
                width={50}
                borderRadius="m"
                overflow="hidden"
                borderWidth={selectedImageIndex === index ? 2 : 1}
                borderColor={
                  selectedImageIndex === index ? 'primary' : 'textSecondary'
                }
                style={{
                  elevation: 4,
                  shadowColor: theme.colors.shadow,
                  shadowOpacity: 0.5,
                  shadowRadius: 3,
                  backgroundColor: theme.colors.cardBackground,
                }}
              >
                <AppImage
                  source={{ uri: img }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              </Box>
            </TouchableOpacity>
          ))}
        </Box>
      </Box>
    </>
  );
};
