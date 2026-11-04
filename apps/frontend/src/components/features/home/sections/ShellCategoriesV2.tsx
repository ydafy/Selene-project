/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * @file components/features/home/sections/ShellCategoriesV2.tsx
 * @description Selector de categorías auditado.
 * Optimizado para evitar re-renders innecesarios y con i18n completo.
 */

import React, { memo, useCallback, useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../../../shared/ui/base';
import { AppImage } from '../../../../shared/ui/app-image';
import { Theme } from '../../../../shared/theme';
import { getSharedStyles } from '../../../../shared/theme/shared-styles';

// --- CONSTANTES ESTÁTICAS ---
const BITS = [...Array(6)];
const STORE_RESULTS_PATH = '/store/results';

/**
 * Micro-componente: Matriz de Bits
 * Extraído para evitar re-creación en cada render.
 */
const Bit = memo(({ index, color }: { index: number; color: string }) => {
  const opacity = useSharedValue(0.2);

  useEffect(() => {
    // Cada paso lleva su propio delay (0.2 -> 1 -> 0.2), como la secuencia original.
    const step = (to: number) =>
      withDelay(index * 150, withTiming(to, { duration: 3500 }));
    opacity.value = withRepeat(withSequence(step(1), step(0.2)), -1, false);
    return () => cancelAnimation(opacity);
  }, [index, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width: 3,
          height: 3,
          backgroundColor: color,
          borderRadius: 1,
        },
        animatedStyle,
      ]}
    />
  );
});

const BitMatrix = memo(({ theme }: { theme: Theme }) => (
  <Box flexDirection="row" flexWrap="wrap" width={20} gap="xs" opacity={0.4}>
    {BITS.map((_, i) => (
      <Bit key={i} index={i} color={theme.colors.primary} />
    ))}
  </Box>
));

/**
 * Barrido de luz bajo el nombre: translateX -60 -> 60 en ida y vuelta.
 */
const ScanSweep = memo(({ color }: { color: string }) => {
  const translateX = useSharedValue(-60);

  useEffect(() => {
    translateX.value = withRepeat(withTiming(60, { duration: 3500 }), -1, true);
    return () => cancelAnimation(translateX);
  }, [translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Animated.View
      style={[
        { width: '100%', height: '100%', backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
});

/**
 * Envuelve el texto de clase con un pulso de opacidad 0.3 <-> 1.
 */
const PulseText = memo(({ children }: { children: React.ReactNode }) => {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 3000 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
});

/**
 * Componente: Fila de Categoría (Strip)
 * Memoizado para ignorar re-renders de la Home si sus datos no cambian.
 */
const CategoryStrip = memo(
  ({
    id,
    name,
    image,
    value,
    isLast,
    onPress,
    theme,
    sharedStyles,
    t,
  }: any) => (
    <Box borderBottomWidth={isLast ? 0 : 1} borderBottomColor="separator">
      <Pressable
        onPress={() => onPress(value || name)}
        style={({ pressed }) => [
          styles.stripPressable,
          {
            backgroundColor: pressed
              ? theme.colors.surfaceSubtle
              : 'transparent',
          },
        ]}
      >
        <Box flex={1} flexDirection="row" alignItems="center">
          <Box
            width={2}
            height="60%"
            backgroundColor="primary"
            opacity={0.3}
            marginRight="m"
          />

          <Box flex={1} gap="xs">
            <Box flexDirection="row" alignItems="center" gap="s">
              <Text
                style={[
                  sharedStyles.monoText,
                  { color: theme.colors.primary, fontSize: 8 },
                ]}
              >
                {t('categories.modPrefix')}
                {id}
              </Text>
              <BitMatrix theme={theme} />
            </Box>

            <Box>
              <Text variant="subheader-lg" color="textPrimary">
                {name}
              </Text>
              <Box
                width={60}
                height={2}
                backgroundColor="separator"
                marginTop="xs"
                overflow="hidden"
                opacity={0.3}
              >
                <ScanSweep color={theme.colors.primary} />
              </Box>
            </Box>

            <Box flexDirection="row" alignItems="center" gap="xs">
              <Text
                style={[sharedStyles.monoText, { fontSize: 7, opacity: 0.5 }]}
              >
                [ {t('categories.classLabel')}{' '}
              </Text>
              <PulseText>
                <Text
                  style={[
                    sharedStyles.monoText,
                    { fontSize: 7, color: theme.colors.primary as string },
                  ]}
                >
                  {t('categories.unitType')}
                </Text>
              </PulseText>
              <Text
                style={[sharedStyles.monoText, { fontSize: 7, opacity: 0.5 }]}
              >
                {' '}
                ]
              </Text>
            </Box>
          </Box>
        </Box>

        <Box flex={1} height={140} justifyContent="center" alignItems="center">
          <AppImage
            source={image}
            style={{ width: '100%', height: '140%' }}
            contentFit="contain"
            memoryKey={`cat-img-${id}`} // Llave única para el pool de memoria
            cachePolicy="memory-disk" // Caché agresiva para evitar parpadeos
          />
        </Box>
      </Pressable>
    </Box>
  ),
);

const ShellCategoriesV2Component = () => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const { t } = useTranslation('home');
  const sharedStyles = getSharedStyles(theme);

  // Memoizamos el handler para que CategoryStrip no se re-renderice
  const handleCategoryPress = useCallback(
    (categoryValue: string) => {
      router.push({
        pathname: STORE_RESULTS_PATH,
        params: { category: categoryValue },
      });
    },
    [router],
  );

  return (
    <Box borderBottomWidth={1} borderBottomColor="separator">
      <Box padding="xl" alignItems="center">
        <Text
          style={[
            sharedStyles.monoText,
            { color: theme.colors.primary, fontSize: 8 },
          ]}
        >
          {t('categories.header')}
        </Text>
        <Text
          variant="header-xl"
          color="textPrimary"
          marginTop="xs"
          textAlign="center"
        >
          {t('categories.title')}
        </Text>
      </Box>

      <CategoryStrip
        id="1"
        name="GPU"
        value="GPU"
        t={t}
        theme={theme}
        sharedStyles={sharedStyles}
        onPress={handleCategoryPress}
        image={require('@/assets/images/home/gpu2Home.webp')}
      />
      <CategoryStrip
        id="2"
        name="CPU"
        value="CPU"
        t={t}
        theme={theme}
        sharedStyles={sharedStyles}
        onPress={handleCategoryPress}
        image={require('@/assets/images/home/cpuHome.webp')}
      />
      <CategoryStrip
        id="3"
        name="RAM"
        value="RAM"
        t={t}
        theme={theme}
        sharedStyles={sharedStyles}
        onPress={handleCategoryPress}
        image={require('@/assets/images/home/ramHome.webp')}
      />
      <CategoryStrip
        id="4"
        name="MOBO"
        value="Motherboard"
        t={t}
        theme={theme}
        sharedStyles={sharedStyles}
        onPress={handleCategoryPress}
        image={require('@/assets/images/home/MoboHome.webp')}
        isLast
      />
    </Box>
  );
};

export const ShellCategoriesV2 = memo(ShellCategoriesV2Component);

const styles = StyleSheet.create({
  stripPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 25,
    minHeight: 180,
  },
});
