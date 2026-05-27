/**
 * @file components/features/shop/sections/ProductSnapCard.tsx
 * @description Versión 1.1: Pure Snap.
 * Diseño minimalista con imagen clickeable, bordes suavizados y fondo adaptativo.
 */

import React, { memo } from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BlurView } from 'expo-blur';
import { Box, Text } from '../../../base';
import { AppImage } from '../../../ui/AppImage';
import { PrimaryButton } from '../../../ui/PrimaryButton';
import { formatCurrency } from '../../../../core/utils/format';
import { Product } from '@selene/types';

interface Props {
  product: Product;
  visibleHeight: number;
}

const ProductSnapCardComponent = ({ product, visibleHeight }: Props) => {
  const router = useRouter();
  const { t } = useTranslation('search');

  const handleNavigate = () => {
    router.push({
      pathname: '/product/[id]',
      params: { id: product.id },
    });
  };

  return (
    <Box height={visibleHeight} backgroundColor="black" overflow="hidden">
      {/* 1. FONDO ADAPTATIVO (Reflejo Difuminado) */}
      <Box style={StyleSheet.absoluteFill}>
        <AppImage
          source={{ uri: product.images[0] }}
          style={[StyleSheet.absoluteFill, { opacity: 0.7 }]}
          contentFit="cover"
          blurRadius={60}
        />
      </Box>

      {/* 2. IMAGEN PRINCIPAL (Área Clickeable) */}
      <Box flex={1} justifyContent="center" alignItems="center" padding="m">
        <Pressable onPress={handleNavigate} style={styles.imagePressable}>
          {({ pressed }) => (
            <Box
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 24, // Suaviza el look cuadrado
                overflow: 'hidden',
                transform: [{ scale: pressed ? 0.98 : 1 }], // Feedback sutil
                opacity: pressed ? 0.9 : 1,
              }}
            >
              <AppImage
                source={{ uri: product.images[0] }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                sharedTransitionTag={`image-${product.id}`}
              />
            </Box>
          )}
        </Pressable>
      </Box>

      {/* 3. INFO ETIQUETA (Side Label Style) */}
      <Box paddingBottom="xl" style={{ marginBottom: 20 }}>
        <Box
          alignSelf="flex-start"
          maxWidth="85%"
          borderTopRightRadius="l"
          borderBottomRightRadius="l"
          overflow="hidden"
          borderWidth={0.5}
          borderLeftWidth={0}
          borderColor="blurBackground"
        >
          <BlurView
            intensity={50}
            tint="dark"
            style={{ padding: 20, paddingLeft: 24 }}
          >
            {/* Línea de Acento Dorada */}
            <Box
              position="absolute"
              left={0}
              top={0}
              bottom={0}
              width={4}
              backgroundColor="primary"
            />

            <Box gap="xs">
              <Text
                variant="caption-md"
                color="primary"
                style={{ letterSpacing: 2, fontWeight: 'bold' }}
              >
                {product.category.toUpperCase()}
              </Text>

              <Text
                variant="header-xl"
                color="textPrimary"
                numberOfLines={2}
                style={{ fontSize: 22, lineHeight: 28 }}
              >
                {product.name.toUpperCase()}
              </Text>

              <Text
                variant="subheader-lg"
                color="primary"
                fontWeight="bold"
                marginTop="xs"
              >
                {formatCurrency(product.price)}
              </Text>

              <PrimaryButton
                onPress={handleNavigate}
                style={{ marginTop: 16 }}
                labelStyle={{ fontSize: 14 }}
              >
                {t('search:buttonTextViewProduct')}
              </PrimaryButton>
            </Box>
          </BlurView>
        </Box>
      </Box>
    </Box>
  );
};

export const ProductSnapCard = memo(ProductSnapCardComponent);

const styles = StyleSheet.create({
  imagePressable: {
    width: '100%',
    height: '70%',
    // Sombra sutil para que la imagen no se vea plana sobre el blur
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
});
