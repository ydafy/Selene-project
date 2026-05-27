/**
 * @file components/features/shop/sections/ShellEndFeedCard.tsx
 * @description Versión 2.0: The Supply Line.
 * Carrusel automático de productos como cierre del Snap Feed.
 */

import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../../base';
import { ProductMiniCard } from '../../product/ProductMiniCard';
import { PrimaryButton } from '../../../ui/PrimaryButton';
import { useProducts } from '../../../../core/hooks/useProducts';
import { getMasonryItemHeight } from '../../../../core/constants/layout';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../../home/sharedStyles';
import { AppImage } from '@/components/ui/AppImage';
import { MotiView } from 'moti';
import SeleneLogo from '../../../../assets/images/SeleneLunaLogo.png';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const ShellEndFeedCard2 = ({
  visibleHeight,
  isActive,
}: {
  visibleHeight: number;
  isActive: boolean;
}) => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const sharedStyles = getSharedStyles(theme);
  const scrollRef = useRef<ScrollView>(null);
  const { t } = useTranslation('search');

  // Traemos los productos (reutilizamos la caché de la Home/Shop)
  const { data: products } = useProducts({ verifiedOnly: true, limit: 10 });

  // --- LÓGICA DE AUTO-SCROLL INFINITO (Sencilla y robusta) ---

  //Podemos usar useAnimatedScrollHanlder si noto que los fps son inestables, pero por ahora esto funciona bien sin animaciones forzadas.
  useEffect(() => {
    if (!isActive) return; // No animar si no se está viendo
    let offset = 400; // Tu offset inicial
    const scrollSpeed = 0.8;

    // FIX: Posicionamiento instantáneo antes de empezar el intervalo
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: offset, animated: false });
    }, 0);

    const interval = setInterval(() => {
      if (scrollRef.current) {
        offset += scrollSpeed;
        if (offset > 1500) offset = 0;
        scrollRef.current.scrollTo({ x: offset, animated: false });
      }
    }, 16);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [isActive]); // Reacciona cuando la tarjeta entra en el foco

  return (
    <Box
      height={visibleHeight}
      backgroundColor="background"
      justifyContent="center"
      paddingBottom={'xl'}
    >
      {/* 1. CONTENIDO CENTRAL (Mensaje y Botón) */}
      <Box
        alignItems="center"
        gap="l"
        style={{ zIndex: 20, paddingHorizontal: 10 }}
      >
        {/* CONTENIDO CENTRAL (Logo + Mensaje + Botón) */}
        <Box alignItems="center" gap="m">
          {/* 1. LOGO DE SELENE */}
          <Box width={70} height={70} marginBottom="s">
            <AppImage
              source={SeleneLogo}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              priority="low"
            />
          </Box>

          <Box alignItems="center">
            <Text variant="header-xl" color="textPrimary" textAlign="center">
              {t('search:shellFotter.title')}
            </Text>
            <Text
              variant="body-sm"
              color="textSecondary"
              textAlign="center"
              style={{ maxWidth: 280, marginTop: 4, lineHeight: 20 }}
            >
              {t('search:shellFotter.description')}
            </Text>
          </Box>

          <PrimaryButton
            onPress={() =>
              router.push({
                pathname: '/store/results',
              })
            }
            style={{
              paddingHorizontal: 40,
              width: '100%',
              maxWidth: 300,
              marginTop: 8,
            }}
            labelStyle={{ fontSize: 16, fontWeight: 'bold' }}
            icon="view-grid-plus-outline"
          >
            EXPLORAR TODO
          </PrimaryButton>
        </Box>
      </Box>

      {/* 2. LA BANDA TRANSPORTADORA (Auto-scroll) */}
      <MotiView
        animate={{
          opacity: isActive ? 1 : 0,
          translateY: isActive ? 0 : 20,
        }}
        transition={{ type: 'timing', duration: 500 }}
        style={{
          position: 'absolute',
          bottom: 60,
          width: '100%',
          height: 250,
          zIndex: 5,
        }}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          pointerEvents="none" // El usuario no interactúa con este scroll
          contentContainerStyle={{
            alignItems: 'flex-end',
            paddingLeft: SCREEN_WIDTH,
          }}
        >
          {/* Mapeo de productos (Asegúrate de que 'products' no sea null) */}
          {products &&
            [...products, ...products].map((product, i) => (
              <Box key={`${product.id}-${i}`} marginRight="m">
                <ProductMiniCard
                  product={product}
                  cardHeight={getMasonryItemHeight(product.aspect_ratio) * 0.8}
                  onPress={() => {}}
                />
              </Box>
            ))}
        </ScrollView>

        {/* Gradientes de desvanecimiento laterales */}
        <LinearGradient
          colors={['#121212', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.edgeGradient, { left: 0 }]}
        />
        <LinearGradient
          colors={['transparent', '#121212']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.edgeGradient, { right: 0 }]}
        />
      </MotiView>

      {/* 3. TELEMETRÍA DE CIERRE */}
      <Box
        position="absolute"
        bottom={20}
        width="100%"
        alignItems="center"
        opacity={0.2}
      >
        <Text style={[sharedStyles.monoText, { fontSize: 8 }]}>
          SELENE_SYSTEM // AUTO_FEED_STOP // READY_FOR_CATALOG
        </Text>
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  edgeGradient: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 20,
    zIndex: 10,
  },
});
