/**
 * @file components/features/home/sections/ShellTrustPipeline.tsx
 * @description Ciclo de confianza auditado.
 * Optimizado para rendimiento y totalmente internacionalizado.
 */

import React, { memo, useEffect } from 'react';
import { LayoutChangeEvent, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import MaterialCommunityIcons, {
  type MaterialDesignIconsIconName,
} from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';

interface PipelineCardProps {
  title: string;
  icon: MaterialDesignIconsIconName;
  isLast?: boolean;
}

/**
 * Tarjeta individual del pipeline.
 * Memoizada para evitar re-renders durante la animación del láser.
 */
const PipelineCard = memo(({ title, icon }: PipelineCardProps) => {
  const theme = useTheme<Theme>();

  return (
    <Box
      flex={1}
      height={120}
      backgroundColor="background"
      borderRadius="s"
      borderWidth={0.5}
      borderColor="separator"
      overflow="hidden"
    >
      {/* Esquina Doblada con Número (Dog-ear) */}
      <Box
        position="absolute"
        top={-1}
        right={-1}
        width={22}
        height={22}
        backgroundColor="cardBackground"
        borderBottomLeftRadius="s"
        borderWidth={0.5}
        borderColor="separator"
        zIndex={10}
        justifyContent="center"
        alignItems="center"
      ></Box>

      <Box flex={1} justifyContent="center" alignItems="center" gap="s">
        <MaterialCommunityIcons
          name={icon}
          size={24}
          color={theme.colors.primary}
        />
        <Text variant="caption-md" color="textPrimary" style={{ fontSize: 12 }}>
          {title}
        </Text>
      </Box>
    </Box>
  );
});

/**
 * Barra de luz que cruza la línea de conexión, de -30% a 100% de su ancho y
 * vuelve a empezar (sin ida y vuelta). Reanimated no interpola porcentajes, así
 * que el ancho de la línea se mide y se anima `translateX` en píxeles.
 */
const FlowBar = memo(({ color }: { color: string }) => {
  const lineWidth = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (-0.3 + 1.3 * progress.value) * lineWidth.value },
    ],
  }));

  return (
    <Animated.View
      onLayout={(e: LayoutChangeEvent) => {
        lineWidth.value = e.nativeEvent.layout.width;
      }}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            width: '30%',
            height: '100%',
            backgroundColor: color,
          },
          animatedStyle,
        ]}
      />
    </Animated.View>
  );
});

const ShellTrustPipelineComponent = () => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('home');
  const sharedStyles = getSharedStyles(theme);

  return (
    <Box padding="l" borderBottomWidth={1} borderBottomColor="separator">
      {/* HEADER DE SECCIÓN */}
      <Box alignItems="center" marginBottom="l">
        <Text
          style={[
            sharedStyles.monoText,
            { color: theme.colors.primary, fontSize: 8 },
          ]}
        >
          {t('pipeline.header')}
        </Text>
        <Text variant="header-xl" color="textPrimary" marginTop="xs">
          {t('pipeline.title')}
        </Text>
      </Box>

      <Box flexDirection="row" alignItems="center" gap="s">
        {/* Línea de conexión con efecto Pulse/Flow */}
        <Box
          position="absolute"
          top="50%"
          left={40}
          right={40}
          height={3}
          backgroundColor="separator"
          opacity={0.8}
          overflow="hidden"
        >
          <FlowBar color={theme.colors.primary} />
        </Box>

        <PipelineCard title={t('pipeline.step1')} icon="upload" />
        <PipelineCard title={t('pipeline.step2')} icon="eye-check-outline" />
        <PipelineCard title={t('pipeline.step3')} icon="cart-check" isLast />
      </Box>
    </Box>
  );
};

export const ShellTrustPipeline = memo(ShellTrustPipelineComponent);
