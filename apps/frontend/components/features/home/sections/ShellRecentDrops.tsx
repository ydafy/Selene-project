/**
 * @file components/features/home/sections/ShellRecentDrops.tsx
 * @description Sección de productos recientes auditada.
 * Optimización de renderizado y limpieza de i18n.
 */

import React, { memo, useCallback } from 'react';
import { ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { MotiView } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../../base';
import { ProductMiniCard } from '../../product/ProductMiniCard';
import { useProducts } from '../../../../core/hooks/useProducts';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';
import { getMasonryItemHeight } from '../../../../core/constants/layout';
import { Product } from '@selene/types';

const STORE_RESULTS_PATH = '/store/results';

const ShellRecentDropsComponent = () => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { t } = useTranslation('home');
  const sharedStyles = getSharedStyles(theme);

  // Hook de datos con filtros de seguridad (Solo verificados y límite de 10)
  const { data: products, isLoading, error: productsError } = useProducts({
    verifiedOnly: true,
    limit: 10,
  });

  // Handler memoizado para navegación
  const handleProductPress = useCallback(
    (product: Product) => {
      router.push(`/product/${product.id}`);
    },
    [router],
  );

  const handleSeeAll = useCallback(() => {
    router.push(STORE_RESULTS_PATH);
  }, [router]);

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
          {t('recentDrops.header')}
        </Text>
        <Text variant="header-xl" color="textPrimary" marginTop="xs">
          {t('recentDrops.title')}
        </Text>
      </Box>

      {/* 2. BANDA DE PRODUCTOS CON GRADIENTES */}
      <Box paddingVertical="l">
        <Box>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 24,
              alignItems: 'flex-end',
            }}
            decelerationRate="fast"
            scrollEventThrottle={16}
          >
            {!isLoading && products?.map((product) => (
              <Box key={product.id} marginRight="m">
                <ProductMiniCard
                  product={product}
                  cardHeight={getMasonryItemHeight(product.aspect_ratio || 1)}
                  onPress={handleProductPress}
                />
              </Box>
            ))}
            {productsError && !products && (
              <Box width={200} justifyContent="center" alignItems="center" padding="l">
                <Text variant="caption-md" color="error" textAlign="center">
                  {t('recentDrops.header')}
                </Text>
                <Text variant="body-sm" color="textSecondary" textAlign="center" marginTop="s">
                  {t('common:states.feedLoadError')}
                </Text>
              </Box>
            )}
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

      {/* 3. CTA PULSANTE */}
      <Box paddingHorizontal="l" paddingVertical="l" alignItems="center">
        <TouchableOpacity onPress={handleSeeAll}>
          <MotiView
            from={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            transition={{
              type: 'timing',
              loop: true,
              duration: 2000,
            }}
            style={{ flexDirection: 'row', alignItems: 'center' }}
          >
            <Text
              variant="caption-md"
              color="primary"
              style={{ letterSpacing: 2 }}
            >
              {t('recentDrops.cta')}
            </Text>
          </MotiView>
        </TouchableOpacity>
      </Box>
    </Box>
  );
};

export const ShellRecentDrops = memo(ShellRecentDropsComponent);

const styles = StyleSheet.create({
  edgeGradient: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 25,
    zIndex: 10,
  },
});
