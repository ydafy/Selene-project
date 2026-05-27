/**
 * @file components/features/product/ProductMiniCard.tsx
 * @description Versión 3.1: Technical Skyline Card.
 * Incluye un rediseño de estado "Vendido" alineado con la estética del Monolito.
 */

import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';
import { formatCurrency } from '../../../core/utils/format';
import { Product } from '@selene/types';
import { getSharedStyles } from '../home/sharedStyles';

interface Props {
  product: Product;
  onPress: (product: Product) => void;
  cardHeight: number;
}

export const ProductMiniCard = ({ product, onPress, cardHeight }: Props) => {
  const theme = useTheme<Theme>();
  const sharedStyles = getSharedStyles(theme);
  const isSold = product.status === 'SOLD';

  return (
    <TouchableOpacity
      onPress={() => onPress(product)}
      activeOpacity={isSold ? 1 : 0.9} // Menos feedback si ya está vendido
    >
      <Box
        backgroundColor="cardBackground"
        borderRadius="m"
        overflow="hidden"
        borderWidth={1}
        borderColor={isSold ? 'separator' : 'separator'}
        width={160}
        height={cardHeight}
        opacity={isSold ? 0.6 : 1} // Atenuamos toda la tarjeta
      >
        {/* 1. AREA VISUAL */}
        <Box flex={1} backgroundColor="background">
          <AppImage
            source={{ uri: product.images[0] }}
            style={[StyleSheet.absoluteFill, { opacity: isSold ? 0.3 : 1 }]}
            contentFit="cover"
          />

          {/* OVERLAY TÉCNICO PARA VENDIDO */}
          {isSold && (
            <Box
              style={StyleSheet.absoluteFill}
              justifyContent="center"
              alignItems="center"
            >
              {/* Líneas diagonales de "bloqueo" (Hatching) */}
              <Box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                opacity={0.1}
                style={{ transform: [{ rotate: '45deg' }, { scale: 2 }] }}
              >
                {[...Array(10)].map((_, i) => (
                  <Box
                    key={i}
                    height={1}
                    backgroundColor="foreground"
                    marginBottom="m"
                  />
                ))}
              </Box>

              {/* Tag de Estado Minimalista */}
              <Box
                backgroundColor="background"
                paddingHorizontal="s"
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

          {/* Sello de Verificación (Solo si no está vendido) */}
          {product.status === 'VERIFIED' && !isSold && (
            <Box
              position="absolute"
              top={8}
              right={8}
              backgroundColor="success"
              borderRadius="full"
            >
              <IconButton
                icon="shield-check"
                size={12}
                iconColor="white"
                style={{ margin: 0, width: 20, height: 20 }}
              />
            </Box>
          )}

          {/* Precio (Oculto o tachado si vendido) */}
          {!isSold && (
            <Box
              position="absolute"
              bottom={8}
              left={8}
              backgroundColor="background"
              paddingHorizontal="s"
              paddingVertical="xs"
              borderRadius="s"
            >
              <Text variant="caption-md" fontWeight="bold" color="primary">
                {formatCurrency(product.price)}
              </Text>
            </Box>
          )}
        </Box>

        {/* 2. INFO BÁSICA */}
        <Box padding="s" backgroundColor="cardBackground">
          <Text
            variant="body-sm"
            numberOfLines={1}
            fontWeight="bold"
            color={isSold ? 'textSecondary' : 'textPrimary'}
            style={{
              fontSize: 10,
              letterSpacing: 0.5,
              textDecorationLine: isSold ? 'line-through' : 'none',
            }}
          >
            {product.name.toUpperCase()}
          </Text>
          <Text
            variant="caption-md"
            color="textSecondary"
            style={{ fontSize: 8, marginTop: 2 }}
          >
            {isSold ? 'OFFLINE' : product.category}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
