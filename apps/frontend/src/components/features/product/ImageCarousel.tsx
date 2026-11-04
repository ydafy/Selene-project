/* eslint-disable @typescript-eslint/no-unused-vars */
import { useState } from 'react';
import {
  ScrollView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Box } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../../core/theme';

const { width } = Dimensions.get('window');
const HEIGHT = 350; // Altura imponente para la imagen

type ImageCarouselProps = {
  images: string[];
};

export const ImageCarousel = ({ images }: ImageCarouselProps) => {
  const theme = useTheme<Theme>();
  const [activeIndex, setActiveIndex] = useState(0);

  // Lógica para calcular qué imagen se está viendo
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = event.nativeEvent.contentOffset.x / slideSize;
    const roundIndex = Math.round(index);
    if (roundIndex !== activeIndex) {
      setActiveIndex(roundIndex);
    }
  };

  return (
    <Box>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16} // Para que la animación sea suave
        style={{ width, height: HEIGHT }}
      >
        {images.map((img, index) => (
          <AppImage
            key={index}
            source={{ uri: img }}
            style={{ width, height: HEIGHT }}
            contentFit="cover"
            transition={200}
          />
        ))}
      </ScrollView>

      {/* Indicadores de Paginación (Dots) */}
      <Box
        position="absolute"
        bottom={20}
        flexDirection="row"
        width="100%"
        justifyContent="center"
        alignItems="center"
      >
        {images.map((_, index) => {
          const isActive = index === activeIndex;
          return (
            <Box
              key={index}
              width={isActive ? 24 : 8} // El activo es más largo (estilo moderno)
              height={8}
              borderRadius="s"
              marginHorizontal="s"
              backgroundColor={isActive ? 'primary' : 'cardBackground'}
              opacity={isActive ? 1 : 0.5}
            />
          );
        })}
      </Box>
    </Box>
  );
};
