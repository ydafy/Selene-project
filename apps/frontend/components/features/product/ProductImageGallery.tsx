import { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import ImageViewing from 'react-native-image-viewing';
import { useTheme } from '@shopify/restyle';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';

import { Box, Text } from '../../base'; // Importamos Text para el contador
import { AppImage } from '../../ui/AppImage';
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

  // --- 1. HEADER (Botón Cerrar) ---
  const renderHeader = () => (
    <SafeAreaView
      edges={['top']}
      style={{ position: 'absolute', top: 0, right: 0, zIndex: 1 }}
    >
      <IconButton
        icon="close"
        iconColor="white"
        size={28}
        onPress={() => setIsViewerVisible(false)}
        style={{ backgroundColor: 'rgba(0,0,0,0.5)', margin: 16 }}
      />
    </SafeAreaView>
  );

  // --- 2. FOOTER (Contador de Imágenes - MUST HAVE) ---
  // Recibe el imageIndex actual automáticamente de la librería
  const renderFooter = ({ imageIndex }: { imageIndex: number }) => (
    <SafeAreaView
      edges={['bottom']}
      style={{
        position: 'absolute',
        bottom: 0,
        width: '100%',
        alignItems: 'center',
        marginBottom: 20,
      }}
    >
      <Box
        backgroundColor="background" // Fondo oscuro
        opacity={0.8}
        paddingHorizontal="m"
        paddingVertical="s"
        borderRadius="l"
      >
        <Text variant="body-md" color="textPrimary" fontWeight="bold">
          {imageIndex + 1} / {images.length}
        </Text>
      </Box>
    </SafeAreaView>
  );

  return (
    <>
      <ImageViewing
        images={imagesForViewer}
        imageIndex={selectedImageIndex}
        visible={isViewerVisible}
        onRequestClose={() => setIsViewerVisible(false)}
        // --- CONFIGURACIÓN PREMIUM ---
        swipeToCloseEnabled={true}
        doubleTapToZoomEnabled={true}
        animationType="fade" // 'fade' suele sentirse más elegante que 'slide' para visores de fotos
        presentationStyle="overFullScreen" // Truco para Android: cubre la barra de estado
        backgroundColor="#000000" // Negro puro para máxima inmersión
        // --- COMPONENTES CUSTOM ---
        HeaderComponent={renderHeader}
        FooterComponent={renderFooter} // Añadimos el contador
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
                  shadowColor: '#000',
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
