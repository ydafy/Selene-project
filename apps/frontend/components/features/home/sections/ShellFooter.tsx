/**
 * @file components/features/home/sections/ShellFooter.tsx
 * @description Cierre oficial del Monolito Selene auditado.
 * Optimizado para rendimiento y con soporte para enlaces externos.
 */

import React, { memo, useCallback } from 'react';
import { TouchableOpacity, Linking, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../../base';
import { AppImage } from '../../../ui/AppImage';
import { Theme } from '../../../../core/theme';
import { getSharedStyles } from '../sharedStyles';

// --- CONFIGURACIÓN DE REDES SOCIALES ---
const SOCIAL_LINKS = {
  TWITTER: 'https://twitter.com/selene_app',
  INSTAGRAM: 'https://instagram.com/selene_app',
  GITHUB: 'https://github.com/selene-hardware',
};

const ShellFooterComponent = () => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('home');
  const sharedStyles = getSharedStyles(theme);

  /**
   * Maneja la apertura de enlaces externos de forma segura.
   */
  const handleSocialPress = useCallback(async (url: string) => {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Error', 'No se pudo abrir el enlace.');
    }
  }, []);

  /**
   * Helper Mono sincronizado con el sistema de diseño.
   */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Mono = ({ children, color = 'textSecondary', size = 8 }: any) => (
    <Text
      style={[
        sharedStyles.monoText,
        {
          color: theme.colors[color as keyof Theme['colors']] || color,
          fontSize: size,
        },
      ]}
    >
      {children}
    </Text>
  );

  return (
    <Box paddingVertical="xl" alignItems="center">
      {/* 1. EL LOGO / ICONO DE MARCA */}
      <Box width={100} height={100} justifyContent="center" alignItems="center">
        <AppImage
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../../../assets/images/SeleneLunaLogo.png')}
          style={{ width: '80%', height: '120%' }}
          contentFit="contain"
          memoryKey="footer-logo-brand"
          priority="low" // El footer es lo último en cargar
        />
      </Box>

      {/* 2. MENSAJE DE MARCA (i18n) */}
      <Box marginTop="xs" alignItems="center" gap="xs">
        <Text
          color="primary"
          textAlign="center"
          style={{
            maxWidth: '60%',
            lineHeight: 24,
            fontStyle: 'italic',
            fontSize: 12,
          }}
        >
          {t('footer.thanks')}
        </Text>
      </Box>

      {/* 3. NODOS SOCIALES (Funcionales) */}
      <Box flexDirection="row" gap="xl" marginTop="xl" opacity={0.6}>
        <TouchableOpacity
          onPress={() => handleSocialPress(SOCIAL_LINKS.TWITTER)}
        >
          <MaterialCommunityIcons
            name="twitter"
            size={20}
            color={theme.colors.textPrimary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleSocialPress(SOCIAL_LINKS.INSTAGRAM)}
        >
          <MaterialCommunityIcons
            name="instagram"
            size={20}
            color={theme.colors.textPrimary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleSocialPress(SOCIAL_LINKS.GITHUB)}
        >
          <MaterialCommunityIcons
            name="github"
            size={20}
            color={theme.colors.textPrimary}
          />
        </TouchableOpacity>
      </Box>

      {/* 4. TELEMETRÍA FINAL (Cierre de Shell) */}
      <Box
        marginTop="xl"
        paddingTop="m"
        borderTopWidth={0.5}
        borderTopColor="separator"
        width="100%"
        alignItems="center"
        opacity={0.3}
      >
        <Mono>{t('footer.telemetry')}</Mono>
      </Box>
    </Box>
  );
};

export const ShellFooter = memo(ShellFooterComponent);
