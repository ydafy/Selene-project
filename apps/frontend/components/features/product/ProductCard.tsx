import { memo } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { MotiView } from 'moti'; // Animaciones
import { Product } from '@selene/types';
import { BlurView } from 'expo-blur';
// Componentes Base y UI
import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { ProductFavoriteButton } from './ProductFavoriteButton';

// Utilidades y Tema
import { Theme } from '../../../core/theme';
import { formatCurrency } from '../../../core/utils/format';

type ProductCardProps = {
  product: Product;
  onPress: (product: Product) => void;
  imageHeight: number;
  index?: number; // Para escalonar la animación
};

// Usamos memo para evitar re-renderizados si las props no cambian
export const ProductCard = memo(
  ({ product, onPress, imageHeight, index = 0 }: ProductCardProps) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const theme = useTheme<Theme>();
    const isSold = product.status === 'SOLD';

    return (
      <MotiView
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{
          type: 'timing',
          duration: 500,
          delay: index * 100, // Efecto cascada: carga uno tras otro
        }}
        style={styles.container}
      >
        <TouchableOpacity
          onPress={() => onPress(product)}
          activeOpacity={0.9}
          // Accesibilidad para lectores de pantalla
          accessibilityLabel={`${product.name}, precio ${formatCurrency(product.price)}, condición ${product.condition}`}
          accessibilityRole="button"
        >
          {/* --- CONTENEDOR FLOTANTE --- */}
          <Box
            backgroundColor="cardBackground"
            borderRadius="m"
            overflow="hidden"
            style={styles.shadow}
            opacity={isSold ? 0.8 : 1} // Un poco más apagado si está vendido
          >
            {/* 1. IMAGEN (Altura Dinámica) */}
            <Box
              height={imageHeight}
              width="100%"
              backgroundColor="background"
              position="relative"
            >
              <AppImage
                source={{ uri: product.images[0] }}
                style={{
                  width: '100%',
                  height: '100%',
                  opacity: isSold ? 0.5 : 1,
                }} // Imagen atenuada si vendido
                sharedTransitionTag={`image-${product.id}`}
                contentFit="cover"
                transition={200}
              />

              {/* OVERLAY DE VENDIDO */}
              {isSold && (
                <Box
                  position="absolute"
                  top={0}
                  left={0}
                  right={0}
                  bottom={0}
                  backgroundColor="background"
                  opacity={0.4}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Box
                    borderWidth={2}
                    borderColor="textPrimary"
                    paddingHorizontal="m"
                    paddingVertical="s"
                    borderRadius="s"
                    style={{ transform: [{ rotate: '-15deg' }] }} // Estilo "sello"
                  >
                    <Text
                      variant="header-xl"
                      color="textPrimary"
                      style={{ fontSize: 18 }}
                    >
                      VENDIDO
                    </Text>
                  </Box>
                </Box>
              )}

              {/* Badge de Precio (Ocultar si vendido para limpiar ruido, o mantener) */}
              {!isSold && (
                <Box
                  position="absolute"
                  bottom={8}
                  left={8}
                  backgroundColor="cardBackground"
                  opacity={0.95}
                  paddingHorizontal="s"
                  paddingVertical="xs"
                  borderRadius="s"
                  overflow="hidden"
                >
                  <BlurView
                    intensity={20}
                    tint="dark"
                    style={StyleSheet.absoluteFill} // Llena el contenedor
                  />

                  <Box
                    paddingHorizontal="s"
                    paddingVertical="xs"
                    //backgroundColor=""
                    opacity={1}
                  >
                    <Text variant="body-sm" fontWeight="bold" color="primary">
                      {formatCurrency(product.price)}
                    </Text>
                  </Box>
                </Box>
              )}

              {/* Badge de Verificado */}
              {product.status === 'VERIFIED' && !isSold && (
                <Box
                  position="absolute"
                  top={8}
                  left={8}
                  backgroundColor="success"
                  paddingHorizontal="xs"
                  paddingVertical="xs"
                  borderRadius="s"
                  flexDirection="row"
                  alignItems="center"
                >
                  <IconButton
                    icon="shield-check"
                    size={10}
                    iconColor="white"
                    style={{ margin: 0, width: 10, height: 10 }}
                  />
                </Box>
              )}

              {/* Botón de Favoritos */}
              <Box position="absolute" top={4} right={4}>
                <Box
                  backgroundColor="cardBackground"
                  borderRadius="full"
                  opacity={0.8}
                  width={28}
                  height={28}
                  justifyContent="center"
                  alignItems="center"
                >
                  <ProductFavoriteButton productId={product.id} size={16} />
                </Box>
              </Box>
            </Box>

            {/* 2. INFORMACIÓN */}
            <Box padding="s">
              <Text
                variant="body-md"
                //fontWeight="bold"
                numberOfLines={2}
                style={{
                  lineHeight: 18,
                  textDecorationLine: isSold ? 'line-through' : 'none',
                }} // Tachado si vendido
                color={isSold ? 'textSecondary' : 'textPrimary'}
                marginBottom="xs"
              >
                {product.name}
              </Text>

              <Text
                variant="caption-md"
                color="textSecondary"
                style={{ fontSize: 10 }}
              >
                {product.category} •{' '}
                {product.condition === 'Usado - Como Nuevo'
                  ? 'Como Nuevo'
                  : 'Usado'}
              </Text>
            </Box>
          </Box>
        </TouchableOpacity>
      </MotiView>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: 16,
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
});
