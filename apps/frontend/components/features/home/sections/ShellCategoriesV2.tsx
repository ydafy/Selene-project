/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * @file components/features/home/sections/ShellCategoriesV2.tsx
 * @description Selector de categorías auditado.
 * Optimizado para evitar re-renders innecesarios y con i18n completo.
 */

import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { MotiView } from 'moti';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../../base';
import { AppImage } from '../../../ui/AppImage';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';

// --- CONSTANTES ESTÁTICAS ---
const BITS = [...Array(6)];
const STORE_RESULTS_PATH = '/store/results';

/**
 * Micro-componente: Matriz de Bits
 * Extraído para evitar re-creación en cada render.
 */
const BitMatrix = memo(({ theme }: { theme: Theme }) => (
  <Box flexDirection="row" flexWrap="wrap" width={20} gap="xs" opacity={0.4}>
    {BITS.map((_, i) => (
      <MotiView
        key={i}
        animate={{ opacity: [0.2, 1, 0.2] }}
        transition={{ loop: true, duration: 3500, delay: i * 150 }}
        style={{
          width: 3,
          height: 3,
          backgroundColor: theme.colors.primary,
          borderRadius: 1,
        }}
      />
    ))}
  </Box>
));

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
              ? 'rgba(255, 255, 255, 0.03)'
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
                <MotiView
                  from={{ translateX: -60 }}
                  animate={{ translateX: 60 }}
                  transition={{ loop: true, duration: 3500, type: 'timing' }}
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: theme.colors.primary,
                  }}
                />
              </Box>
            </Box>

            <Box flexDirection="row" alignItems="center" gap="xs">
              <Text
                style={[sharedStyles.monoText, { fontSize: 7, opacity: 0.5 }]}
              >
                [ {t('categories.classLabel')}{' '}
              </Text>
              <MotiView
                from={{ opacity: 0.3 }}
                animate={{ opacity: 1 }}
                transition={{ loop: true, duration: 3000, type: 'timing' }}
              >
                <Text
                  style={[
                    sharedStyles.monoText,
                    { fontSize: 7, color: theme.colors.primary as string },
                  ]}
                >
                  {t('categories.unitType')}
                </Text>
              </MotiView>
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
        image={require('../../../../assets/images/home/gpu2Home.webp')}
      />
      <CategoryStrip
        id="2"
        name="CPU"
        value="CPU"
        t={t}
        theme={theme}
        sharedStyles={sharedStyles}
        onPress={handleCategoryPress}
        image={require('../../../../assets/images/home/cpuHome.webp')}
      />
      <CategoryStrip
        id="3"
        name="RAM"
        value="RAM"
        t={t}
        theme={theme}
        sharedStyles={sharedStyles}
        onPress={handleCategoryPress}
        image={require('../../../../assets/images/home/ramHome.webp')}
      />
      <CategoryStrip
        id="4"
        name="MOBO"
        value="Motherboard"
        t={t}
        theme={theme}
        sharedStyles={sharedStyles}
        onPress={handleCategoryPress}
        image={require('../../../../assets/images/home/MoboHome.webp')}
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
