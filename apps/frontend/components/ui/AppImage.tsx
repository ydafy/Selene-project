import { Image, ImageProps } from 'expo-image';

// Definimos las props, heredando de las props de expo-image.
type AppImageProps = ImageProps;

/**
 * AppImage es nuestro componente de imagen estandarizado.
 * Encapsula <Image> de 'expo-image' para proporcionar un rendimiento optimizado,
 * caché avanzada y un control centralizado de estilos.
 */
export const AppImage = (props: AppImageProps) => {
  return (
    <Image
      // Pasamos todas las props (source, style, etc.) al componente interno.
      {...props}
      // Podemos definir props por defecto aquí para toda la app.
      // Por ejemplo, una transición de fade-in suave.
      transition={300}
    />
  );
};
