import { Box } from '../../base';
import { Skeleton } from '../../ui/Skeleton';
//import { useTheme } from '@shopify/restyle';
//import { Theme } from '../../../core/theme';

type ProductCardSkeletonProps = {
  height?: number; // Altura dinámica
};

export const ProductCardSkeleton = ({
  height = 260,
}: ProductCardSkeletonProps) => {
  //const theme = useTheme<Theme>();

  return (
    <Box
      width="100%" // Ocupa el ancho de la columna
      marginBottom="m"
      backgroundColor="cardBackground"
      borderRadius="m"
      overflow="hidden"
    >
      {/* Imagen con altura variable */}
      <Skeleton width="100%" height={height} borderRadius={0} />

      {/* Contenido de texto */}
      <Box padding="s">
        {/* Título */}
        <Skeleton width="90%" height={14} />
        <Box height={4} />
        <Skeleton width="40%" height={14} />

        <Box height={8} />
        {/* Metadatos */}
        <Skeleton width="50%" height={12} />
      </Box>
    </Box>
  );
};
