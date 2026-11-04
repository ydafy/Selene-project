/**
 * @file components/features/home/sections/ShellRecentlyViewed.tsx
 * @description Sección de historial de usuario auditada.
 * Optimización de renderizado y consistencia visual Skyline.
 */

import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { Box, Text } from '../../../base';
import { ProductMiniCard } from '../../product/ProductMiniCard';
import { useRecentlyViewed } from '../../../../core/store/useRecentlyViewed';
import { getMasonryItemHeight } from '../../../../core/constants/layout';
import { getSharedStyles } from '../sharedStyles';
import { Theme } from '../../../../core/theme';
import { Product } from '@selene/types';

const ShellRecentlyViewedComponent = () => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { t } = useTranslation('home');
  const sharedStyles = getSharedStyles(theme);

  // Hook de datos del historial (Zustand + Supabase)
  const { data: products, isLoading } = useRecentlyViewed();

  // Handler memoizado para navegación al detalle
  const handleProductPress = useCallback(
    (product: Product) => {
      router.push(`/product/${product.id}`);
    },
    [router],
  );

  // Si no hay productos vistos, el componente es invisible (Módulo al 99%)
  if (!isLoading && (!products || products.length === 0)) return null;

  return (
    <Box borderBottomWidth={1} borderBottomColor="separator">
      {/* 1. HEADER EDITORIAL */}
      <Box padding="l">
        <Text
          style={[
            sharedStyles.monoText,
            { color: theme.colors.primary, fontSize: 8 },
          ]}
        >
          {t('recentlyViewed.header')}
        </Text>
        <Text variant="header-xl" color="textPrimary" marginTop="xs">
          {t('recentlyViewed.title')}
        </Text>
      </Box>

      {/* 2. BANDA DE PRODUCTOS (Skyline Layout) */}
      <Box paddingVertical="xl">
        <Box>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 24,
              alignItems: 'flex-end', // Efecto Skyline (Alineación inferior)
            }}
            decelerationRate="fast"
            scrollEventThrottle={16}
          >
            {products?.map((product) => (
              <Box key={product.id} marginRight="m">
                <ProductMiniCard
                  product={product}
                  cardHeight={getMasonryItemHeight(product.aspect_ratio)}
                  onPress={handleProductPress}
                />
              </Box>
            ))}
          </ScrollView>

          {/* Gradiente Izquierdo para desvanecimiento */}
          <LinearGradient
            colors={[theme.colors.background, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.5, y: 0 }}
            style={[styles.edgeGradient, { left: 0 }]}
            pointerEvents="none"
          />

          {/* Gradiente Derecho para desvanecimiento */}
          <LinearGradient
            colors={['transparent', theme.colors.background]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.5, y: 0 }}
            style={[styles.edgeGradient, { right: 0 }]}
            pointerEvents="none"
          />
        </Box>
      </Box>
    </Box>
  );
};

export const ShellRecentlyViewed = memo(ShellRecentlyViewedComponent);

const styles = StyleSheet.create({
  edgeGradient: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 25,
    zIndex: 10,
  },
});
