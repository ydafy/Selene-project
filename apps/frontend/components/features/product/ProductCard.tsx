/**
 * @file components/features/product/ProductCard.tsx
 * @description Versión 2.0: Pinterest Style Card con desactivación técnica.
 * Aplica el lenguaje visual del Monolito al estado "Vendido".
 */

import React, { memo } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { MotiView } from 'moti';
import { Product } from '@selene/types';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { ProductFavoriteButton } from './ProductFavoriteButton';
import { Theme } from '../../../core/theme';
import { formatCurrency } from '../../../core/utils/format';
import { getSharedStyles } from '../home/sharedStyles';

type ProductCardProps = {
  product: Product;
  onPress: (product: Product) => void;
  imageHeight: number;
  index?: number;
};

export const ProductCard = memo(
  ({ product, onPress, imageHeight, index = 0 }: ProductCardProps) => {
    const theme = useTheme<Theme>();
    const sharedStyles = getSharedStyles(theme);
    const isSold = product.status === 'SOLD';

    return (
      <MotiView
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 500, delay: index * 100 }}
        style={styles.container}
      >
        <TouchableOpacity
          onPress={() => onPress(product)}
          activeOpacity={isSold ? 1 : 0.9}
        >
          <Box
            backgroundColor="cardBackground"
            borderRadius="m"
            overflow="hidden"
            style={styles.shadow}
            opacity={isSold ? 0.7 : 1}
          >
            {/* 1. AREA VISUAL (Altura Dinámica) */}
            <Box height={imageHeight} width="100%" backgroundColor="background">
              <AppImage
                source={{ uri: product.images[0] }}
                style={{
                  width: '100%',
                  height: '100%',
                  opacity: isSold ? 0.3 : 1,
                }}
                sharedTransitionTag={`image-${product.id}`}
                priority="normal"
                cachePolicy="memory-disk"
                memoryKey={`prod-img-${product.id}`}
                contentFit="cover"
              />

              {/* OVERLAY TÉCNICO PARA VENDIDO */}
              {isSold && (
                <Box
                  style={StyleSheet.absoluteFill}
                  justifyContent="center"
                  alignItems="center"
                >
                  {/* Líneas diagonales (Hatching) */}
                  <Box
                    position="absolute"
                    top={0}
                    left={0}
                    right={0}
                    bottom={0}
                    opacity={0.1}
                    style={{ transform: [{ rotate: '45deg' }, { scale: 3 }] }}
                  >
                    {[...Array(15)].map((_, i) => (
                      <Box
                        key={i}
                        height={1}
                        backgroundColor="foreground"
                        marginBottom="m"
                      />
                    ))}
                  </Box>

                  {/* Tag de Estado Monospace */}
                  <Box
                    backgroundColor="background"
                    paddingHorizontal="m"
                    paddingVertical="xs"
                    borderRadius="s"
                    borderWidth={1}
                    borderColor="textSecondary"
                  >
                    <Text
                      style={[
                        sharedStyles.monoText,
                        {
                          fontSize: 12,
                          color: theme.colors.textSecondary as string,
                        },
                      ]}
                    >
                      [ VENDIDO ]
                    </Text>
                  </Box>
                </Box>
              )}

              {/* Elementos Activos (Solo si NO está vendido) */}
              {!isSold && (
                <>
                  {/* Badge de Precio */}
                  <Box
                    position="absolute"
                    bottom={8}
                    left={8}
                    backgroundColor="background"
                    paddingHorizontal="s"
                    paddingVertical="xs"
                    borderRadius="s"
                  >
                    <Text variant="body-sm" fontWeight="bold" color="primary">
                      {formatCurrency(product.price)}
                    </Text>
                  </Box>

                  {/* Badge de Verificado */}
                  {product.status === 'VERIFIED' && (
                    <Box
                      position="absolute"
                      top={8}
                      left={8}
                      backgroundColor="success"
                      borderRadius="s"
                    >
                      <IconButton
                        icon="shield-check"
                        size={10}
                        iconColor="white"
                        style={{ margin: 0, width: 18, height: 18 }}
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
                </>
              )}
            </Box>

            {/* 2. INFORMACIÓN */}
            <Box padding="s">
              <Text
                variant="body-md"
                numberOfLines={2}
                color={isSold ? 'textPrimary' : 'textPrimary'}
                style={{
                  lineHeight: 18,
                  textDecorationLine: isSold ? 'line-through' : 'none',
                  opacity: isSold ? 0.6 : 1,
                }}
              >
                {product.name.toUpperCase()}
              </Text>

              <Text
                variant="caption-md"
                color="textSecondary"
                style={{ fontSize: 10, marginTop: 4 }}
              >
                {isSold
                  ? 'Offline'
                  : `${product.category} • ${product.condition}`}
              </Text>
            </Box>
          </Box>
        </TouchableOpacity>
      </MotiView>
    );
  },
);

const styles = StyleSheet.create({
  container: { width: '100%', marginBottom: 16 },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
});
