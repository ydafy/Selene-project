/**
 * @file components/features/shop/sections/BrandSnapCard.tsx
 * @description Versión 16.0: Stable Frosted Edition.
 * Logra el efecto de vidrio exagerado mediante capas de contraste y máxima intensidad.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@shopify/restyle';
import { BlurView } from 'expo-blur';

import { Box, Text } from '../../base';
import { BrandIcon } from '../../ui/BrandIcon';
import { Theme } from '../../../core/theme';
import { getSharedStyles } from '../home/sharedStyles';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CELL_SIZE = 25;
const ACCENT_STEP = 3;

const BRANDS = [
  'nvidia',
  'amd',
  'intel',
  'asus',
  'msi',
  'gigabyte',
  'corsair',
  'g.skill',
  'kingston',
];

const BrandSnapCardComponent = ({
  visibleHeight,
}: {
  visibleHeight: number;
}) => {
  const theme = useTheme<Theme>();
  const router = useRouter();
  const sharedStyles = getSharedStyles(theme);
  const cellHeight = visibleHeight / 3;

  // 1. REJILLA TÉCNICA (Base del diseño)
  const gridLines = useMemo(() => {
    const horizontal = [...Array(Math.ceil(visibleHeight / CELL_SIZE))].map(
      (_, i) => (
        <Box
          key={`h-${i}`}
          position="absolute"
          top={i * CELL_SIZE}
          left={0}
          right={0}
          height={1}
          backgroundColor="foreground"
          opacity={i % ACCENT_STEP === 0 ? 0.1 : 0.03}
        />
      ),
    );

    const vertical = [...Array(Math.ceil(SCREEN_WIDTH / CELL_SIZE))].map(
      (_, i) => (
        <Box
          key={`v-${i}`}
          position="absolute"
          left={i * CELL_SIZE}
          top={0}
          bottom={0}
          width={1}
          backgroundColor="foreground"
          opacity={i % ACCENT_STEP === 0 ? 0.1 : 0.03}
        />
      ),
    );

    return { horizontal, vertical };
  }, [visibleHeight]);

  return (
    <Box height={visibleHeight} backgroundColor="background" overflow="hidden">
      {/* CAPA 1: REJILLA */}
      <Box style={StyleSheet.absoluteFill} pointerEvents="none">
        {gridLines.horizontal}
        {gridLines.vertical}
      </Box>

      {/* CAPA 2: GRID DE MÓDULOS */}
      <Box flex={1} flexDirection="row" flexWrap="wrap">
        {BRANDS.map((brand) => (
          <Box key={brand} width="33.33%" height={cellHeight} padding="s">
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/store/results',
                  params: { query: brand },
                })
              }
              style={({ pressed }) => [
                styles.glassCard,
                {
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                  borderColor: pressed
                    ? theme.colors.primary
                    : 'rgba(255, 255, 255, 0.12)',
                  // El color de fondo con opacidad ayuda al Blur a verse más denso
                  backgroundColor: 'rgba(30, 30, 30, 0.3)',
                },
              ]}
            >
              {/* EL BLUR ESTÁNDAR AL MÁXIMO */}
              <BlurView
                intensity={100}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />

              {/* CONTENIDO */}
              <Box flex={1} justifyContent="center" alignItems="center">
                <BrandIcon
                  name={brand}
                  size={52}
                  color={theme.colors.textPrimary}
                />
              </Box>
            </Pressable>
          </Box>
        ))}
      </Box>

      {/* CAPA 3: TELEMETRÍA */}
      <Box
        position="absolute"
        bottom={15}
        width="100%"
        alignItems="center"
        opacity={0.2}
        pointerEvents="none"
      >
        <Text
          style={[sharedStyles.monoText, { fontSize: 7, letterSpacing: 4 }]}
        >
          [ STABLE_FROST_VAULT_v16 ]
        </Text>
      </Box>
    </Box>
  );
};

export const BrandSnapCard = React.memo(BrandSnapCardComponent);

const styles = StyleSheet.create({
  glassCard: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 0.8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 12,
  },
});
