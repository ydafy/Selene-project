/**
 * @file components/features/home/sections/ShellTrustPipeline.tsx
 * @description Ciclo de confianza auditado.
 * Optimizado para rendimiento y totalmente internacionalizado.
 */

import React, { memo } from 'react';
import { Easing } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';

import { Box, Text } from '../../../base';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';

interface PipelineCardProps {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
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
          <MotiView
            from={{ left: '-30%' }}
            animate={{ left: '100%' }}
            transition={{
              loop: true,
              repeatReverse: false,
              duration: 3000,
              type: 'timing',
              easing: Easing.bezier(0.4, 0, 0.2, 1),
            }}
            style={{
              position: 'absolute',
              width: '30%',
              height: '100%',
              backgroundColor: theme.colors.primary,
            }}
          />
        </Box>

        <PipelineCard title={t('pipeline.step1')} icon="upload" />
        <PipelineCard title={t('pipeline.step2')} icon="eye-check-outline" />
        <PipelineCard title={t('pipeline.step3')} icon="cart-check" isLast />
      </Box>
    </Box>
  );
};

export const ShellTrustPipeline = memo(ShellTrustPipelineComponent);
