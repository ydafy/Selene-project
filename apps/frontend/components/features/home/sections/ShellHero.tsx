/**
 * @file components/features/home/sections/ShellHero.tsx
 * @description Sección Hero de la Home.
 * Auditada para rendimiento (Memo) e internacionalización (i18n).
 */

import React, { memo } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { MotiView } from 'moti';

import { Box, Text } from '../../../base';
import { AppImage } from '../../../ui/AppImage';
import { PrimaryButton } from '../../../ui/PrimaryButton';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';

// --- CONSTANTES DE RUTA (Sincronizadas con index.tsx) ---
const STORE_PATH = '/store/query';

const ShellHeroComponent = () => {
  const { t } = useTranslation('home');
  const theme = useTheme<Theme>();
  const router = useRouter();
  const styles = getSharedStyles(theme);

  return (
    <Box>
      {/* 1. CELDA DE TEXTO */}
      <Box padding="xl" alignItems="center">
        <Text
          variant="header-2xl"
          textAlign="center"
          color="textPrimary"
          style={{ lineHeight: 40 }}
        >
          {t('hero.titlePart1')}{' '}
          <Text color="primary" style={{ fontStyle: 'italic' }}>
            {t('hero.titleHighlight')}
          </Text>{' '}
          {t('hero.titlePart2')}
        </Text>
        <Text
          variant="body-md"
          color="textSecondary"
          textAlign="center"
          marginTop="m"
          style={{ opacity: 0.8, lineHeight: 22, maxWidth: '90%' }}
        >
          {t('hero.subtitle')}
        </Text>
      </Box>

      {/* 2. CELDA VISUAL */}
      <Box
        height={320}
        width="100%"
        justifyContent="center"
        alignItems="center"
      >
        <Box position="absolute" top={15} left={15} opacity={0.3}>
          <Text
            style={[
              styles.monoText,
              { color: theme.colors.textSecondary, fontSize: 8 },
            ]}
          >
            MODEL_REF: SLN-2077
          </Text>
        </Box>

        <AppImage
          source={require('../../../../assets/images/home/gpuHome.webp')}
          style={{ width: '90%', height: '80%' }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />

        <MotiView
          from={{ translateY: -100, opacity: 0 }}
          animate={{ translateY: 100, opacity: 0.5 }}
          transition={{ loop: true, duration: 2500, type: 'timing' }}
          style={{
            position: 'absolute',
            width: '80%',
            height: 1,
            backgroundColor: theme.colors.primary,
            zIndex: 10,
          }}
        />
      </Box>

      {/* 3. CELDA DE ACCIÓN */}
      <Box
        padding="l"
        alignItems="center"
        borderBottomWidth={2}
        borderBottomColor="separator"
      >
        <PrimaryButton
          onPress={() => router.push(STORE_PATH)}
          style={{ width: '100%', maxWidth: 280 }}
          icon="shopping-outline"
        >
          {t('hero.cta')}
        </PrimaryButton>
        <Text
          style={[
            styles.monoText,
            { color: theme.colors.textSecondary, marginTop: 16, fontSize: 10 },
          ]}
        >
          {t('hero.systemStatus')}
        </Text>
      </Box>
    </Box>
  );
};

// Exportamos con memo para evitar re-renders innecesarios en la Home
export const ShellHero = memo(ShellHeroComponent);
