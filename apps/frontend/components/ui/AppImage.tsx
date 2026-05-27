/**
 * @file components/ui/AppImage.tsx
 * @description Componente de imagen optimizado con expo-image.
 * Versión auditada: Blindaje de memoria y consistencia multiplataforma.
 */

import { Image, ImageProps } from 'expo-image';
import Animated from 'react-native-reanimated';

export const AnimatedExpoImage = Animated.createAnimatedComponent(Image);

type AppImageProps = ImageProps & {
  sharedTransitionTag?: string;
  memoryKey?: string;
};

export const AppImage = ({
  sharedTransitionTag,
  style,
  memoryKey,
  ...props
}: AppImageProps) => {
  const imageStyle = [{ backgroundColor: 'transparent' }, style];

  // --- MEJORA: Detección inteligente de la fuente para el reciclaje ---
  const getRecyclingKey = () => {
    if (memoryKey) return memoryKey;
    if (typeof props.source === 'string') return props.source;
    // Si es un objeto { uri: '...' }, extraemos la URL como llave
    if (
      typeof props.source === 'object' &&
      props.source !== null &&
      'uri' in props.source
    ) {
      return (props.source as { uri: string }).uri;
    }
    return undefined;
  };

  const commonProps = {
    ...props,
    transition: props.transition ?? 300,
    recyclingKey: getRecyclingKey(),
    cachePolicy: props.cachePolicy ?? 'memory-disk',
    // Aseguramos que el placeholder siempre encaje con el diseño
    placeholderContentFit: props.placeholderContentFit ?? 'cover',
  };

  if (sharedTransitionTag) {
    return <AnimatedExpoImage {...commonProps} style={imageStyle} />;
  }

  return <Image {...commonProps} style={imageStyle} />;
};
