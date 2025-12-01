import { Dimensions } from 'react-native';
import { Box } from '../../base';
import { Skeleton } from '../../ui/Skeleton';
//import { useTheme } from '@shopify/restyle';
//import { Theme } from '../../../core/theme';

const { width } = Dimensions.get('window');
// Mismo cálculo que en ProductCard
const CARD_WIDTH = width / 2 - 24;

export const ProductCardSkeleton = () => {
  //const theme = useTheme<Theme>();

  return (
    <Box
      width={CARD_WIDTH}
      height={260}
      marginBottom="m"
      backgroundColor="cardBackground"
      borderRadius="m"
      overflow="hidden"
    >
      {/* Imagen */}
      <Skeleton width="100%" height={160} borderRadius={0} />

      {/* Contenido de texto */}
      <Box padding="s">
        {/* Precio */}
        <Skeleton width="60%" height={20} />
        <Box height={8} />
        {/* Título linea 1 */}
        <Skeleton width="90%" height={14} />
        <Box height={4} />
        {/* Título linea 2 */}
        <Skeleton width="40%" height={14} />

        <Box height={8} />
        {/* Condición */}
        <Skeleton width="50%" height={12} />
      </Box>
    </Box>
  );
};
