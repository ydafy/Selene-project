import { Dimensions } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box } from '../../base';
import { Skeleton } from '../../ui/Skeleton'; // Nuestro componente Moti
import { Theme } from '../../../core/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const ProductDetailSkeleton = () => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();

  return (
    <Box flex={1} backgroundColor="background">
      {/* 1. IMAGEN PRINCIPAL (Simulada) */}
      {/* Ocupa un poco menos de la mitad de la pantalla, como en el diseño real */}
      <Skeleton width="100%" height={SCREEN_HEIGHT * 0.45} borderRadius={0} />

      {/* 2. CONTENEDOR DE INFO (Efecto Bottom Sheet) */}
      <Box
        flex={1}
        backgroundColor="background"
        borderTopLeftRadius="xl"
        borderTopRightRadius="xl"
        paddingHorizontal="l"
        paddingTop="l"
        // El mismo margen negativo para que se solape con la imagen
        style={{ marginTop: -theme.spacing.xl }}
      >
        {/* Barra decorativa (Handle) */}
        <Box alignSelf="center" marginBottom="l">
          <Skeleton width={40} height={4} borderRadius={2} />
        </Box>

        {/* Categoría y Condición (Píldoras) */}
        <Box flexDirection="row" marginBottom="m" gap="s">
          <Skeleton width={60} height={24} borderRadius={4} />
          <Skeleton width={100} height={24} borderRadius={4} />
        </Box>

        {/* Título */}
        <Box marginBottom="s">
          <Skeleton width="80%" height={32} />
        </Box>

        {/* Precio */}
        <Box marginBottom="l" alignItems="flex-end">
          <Skeleton width={120} height={32} />
        </Box>

        {/* Vendedor (Tarjeta) */}
        <Box
          flexDirection="row"
          alignItems="center"
          marginBottom="l"
          padding="m"
          backgroundColor="cardBackground"
          borderRadius="m"
        >
          {/* Avatar */}
          <Skeleton width={40} height={40} borderRadius={20} />
          <Box marginLeft="m" gap="xs">
            <Skeleton width={100} height={16} />
            <Skeleton width={80} height={12} />
          </Box>
        </Box>

        {/* Specs (Grid simulado) */}
        <Box flexDirection="row" flexWrap="wrap" gap="s" marginTop="m">
          <Skeleton width="48%" height={60} borderRadius={8} />
          <Skeleton width="48%" height={60} borderRadius={8} />
        </Box>
      </Box>

      {/* 3. BARRA INFERIOR (Botón) */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        paddingHorizontal="m"
        paddingTop="m"
        style={{ paddingBottom: Math.max(insets.bottom, 20) }}
        backgroundColor="background"
        borderTopWidth={1}
        borderTopColor="cardBackground"
      >
        <Box flexDirection="row" gap="m">
          <Skeleton width={60} height={60} borderRadius={30} />
          <Skeleton width="80%" height={60} borderRadius={40} />
        </Box>
      </Box>
    </Box>
  );
};
