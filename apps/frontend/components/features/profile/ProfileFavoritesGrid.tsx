import { Dimensions, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';
import { Product } from '@selene/types';

const { width } = Dimensions.get('window');
// Calculamos el ancho para 3 columnas
// (Ancho pantalla - margins) / 3
const ITEM_SIZE = (width - 32) / 3;

type ProfileFavoritesGridProps = {
  favorites: Product[];
  isLoading: boolean;
};

export const ProfileFavoritesGrid = ({
  favorites,
  isLoading,
}: ProfileFavoritesGridProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('profile');
  const router = useRouter();

  const handlePress = (productId: string) => {
    router.push({
      pathname: '/product/[id]',
      params: { id: productId },
    });
  };

  if (isLoading) {
    // Skeleton simple: 3 cajas grises
    return (
      <Box flexDirection="row" gap="s" paddingHorizontal="m" marginTop="l">
        {[1, 2, 3].map((i) => (
          <Box
            key={i}
            width={ITEM_SIZE}
            height={ITEM_SIZE}
            backgroundColor="cardBackground"
            borderRadius="m"
          />
        ))}
      </Box>
    );
  }

  if (favorites.length === 0) {
    return (
      <Box padding="l" alignItems="center" marginTop="m">
        <MaterialCommunityIcons
          name="heart-outline"
          size={40}
          color={theme.colors.textSecondary}
        />
        <Text variant="body-md" color="textSecondary" marginTop="s">
          {t('sections.emptyFavorites')}
        </Text>
      </Box>
    );
  }

  return (
    <Box marginTop="l" paddingHorizontal="m">
      {/* Título de Sección */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginBottom="m"
      >
        <Text
          variant="subheader-lg"
          style={{ textTransform: 'uppercase', letterSpacing: 1 }}
          color="primary"
        >
          {t('sections.favorites') || 'Tus Favoritos'}
        </Text>
        {/* Botón Ver Todos (Visual por ahora) */}
        <TouchableOpacity>
          <Text variant="body-sm" color="textSecondary">
            {t('sections.viewAll')}
          </Text>
        </TouchableOpacity>
      </Box>

      {/* Grid de Imágenes */}
      <Box flexDirection="row" flexWrap="wrap" style={{ gap: 4 }}>
        {favorites.map((product) => (
          <TouchableOpacity
            key={product.id}
            activeOpacity={0.8}
            onPress={() => handlePress(product.id)}
          >
            <Box
              width={ITEM_SIZE - 3} // Ajuste fino para el gap
              height={ITEM_SIZE - 3}
              borderRadius="m"
              overflow="hidden"
              backgroundColor="cardBackground"
            >
              <AppImage
                source={{ uri: product.images[0] }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            </Box>
          </TouchableOpacity>
        ))}
      </Box>
    </Box>
  );
};
