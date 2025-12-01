import { TouchableOpacity, Dimensions } from 'react-native';
//import { useTheme } from '@shopify/restyle';
import { Product } from '@selene/types';
import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
//import { Theme } from '../../../core/theme';
// IMPORTACIÓN NUEVA: Solo importamos el botón inteligente
import { ProductFavoriteButton } from './ProductFavoriteButton';
import { formatCurrency } from '@/core/utils/format';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width / 2 - 24;

type ProductCardProps = {
  product: Product;
  onPress: (product: Product) => void;
};

export const ProductCard = ({ product, onPress }: ProductCardProps) => {
  //const theme = useTheme<Theme>();
  // ¡ADIÓS a los hooks useAuthContext, useProductFavorite y Toast aquí!

  return (
    <TouchableOpacity
      onPress={() => onPress(product)}
      activeOpacity={0.8}
      style={{ width: CARD_WIDTH, marginBottom: 16 }}
    >
      <Box
        backgroundColor="cardBackground"
        borderRadius="m"
        overflow="hidden"
        height={290}
      >
        <Box height={160} width="100%" backgroundColor="background">
          <AppImage
            source={{ uri: product.images[0] }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />

          {/* Botón de Favoritos Flotante */}
          <Box position="absolute" top={4} right={4}>
            {/* ¡MIRA QUÉ LIMPIO! Solo le pasamos el ID */}
            <ProductFavoriteButton productId={product.id} size={20} />
          </Box>

          {/* Insignia de Verificado */}
          {product.status === 'VERIFIED' && (
            <Box
              position="absolute"
              bottom={8}
              left={8}
              backgroundColor="success"
              paddingHorizontal="s"
              paddingVertical="xs"
              borderRadius="s"
            >
              <Text
                variant="body-sm"
                style={{ color: 'white', fontWeight: 'bold', fontSize: 10 }}
              >
                VERIFICADO
              </Text>
            </Box>
          )}

          {/* --- NUEVO: Insignia de Vendido --- */}
          {product.status === 'SOLD' && (
            <Box
              position="absolute"
              bottom={8}
              left={8}
              backgroundColor="cardBackground" // Gris oscuro
              paddingHorizontal="s"
              paddingVertical="xs"
              borderRadius="s"
              borderWidth={1}
              borderColor="primary"
            >
              <Text
                variant="body-sm"
                style={{
                  color: '#bd9f65',
                  fontWeight: 'bold',
                  fontSize: 10,
                }}
              >
                VENDIDO
              </Text>
            </Box>
          )}
        </Box>

        <Box padding="s" flex={1} justifyContent="space-between">
          <Box>
            <Text variant="subheader-md" color="primary" fontWeight="bold">
              {formatCurrency(product.price)}
            </Text>
            <Text variant="body-md" numberOfLines={2} marginTop="s">
              {product.name}
            </Text>
          </Box>
          <Text variant="caption-md" color="textSecondary" marginTop="s">
            {product.condition}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
