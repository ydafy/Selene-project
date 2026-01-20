import { Image, ImageProps } from 'expo-image';
import Animated from 'react-native-reanimated'; // <-- Importar Reanimated

// Creamos una versión animada del componente Image de Expo
export const AnimatedExpoImage = Animated.createAnimatedComponent(Image);

type AppImageProps = ImageProps & {
  // Añadimos soporte opcional para sharedTransitionTag
  sharedTransitionTag?: string;
};

export const AppImage = ({
  sharedTransitionTag,
  style,
  ...props
}: AppImageProps) => {
  const imageStyle = [
    { backgroundColor: 'transparent' }, // <--- ESTO EVITA EL FLASH BLANCO
    style,
  ];
  // Si nos pasan un tag, usamos la versión animada
  if (sharedTransitionTag) {
    return (
      <AnimatedExpoImage
        style={imageStyle}
        placeholderContentFit="cover"
        {...props}
        transition={300}
      />
    );
  }

  // Si no, usamos la normal (para no sobrecargar donde no se necesita)
  return (
    <Image
      {...props}
      transition={300}
      cachePolicy="memory-disk"
      style={imageStyle}
    />
  );
};
