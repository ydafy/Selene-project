/**
 * @file apps/frontend/app/(auth)/register.tsx
 * @description Pantalla de registro de usuario.
 * Contenedor de alto nivel que gestiona el layout y la navegación post-registro.
 */

import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { AppImage } from '../../components/ui/AppImage';
import { Box, Text } from '../../components/base';
import { RegisterForm } from '../../components/features/auth/RegisterForm';
import { Theme } from '../../core/theme';

const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

export default function RegisterScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  /**
   * Se ejecuta cuando el registro por email es exitoso.
   * El usuario necesita confirmar su correo.
   */
  const handleRegisterSuccess = (email: string) => {
    router.replace({
      pathname: '/(auth)/verify-code',
      params: { email },
    });
  };

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />

      {/* BOTÓN DE ATRÁS: Dinámico con Safe Area */}
      <Box
        position="absolute"
        top={insets.top > 0 ? insets.top : 20}
        left={theme.spacing.s}
        zIndex={10}
      >
        <IconButton
          icon="arrow-left"
          iconColor={theme.colors.textPrimary}
          size={28}
          onPress={() => router.back()}
        />
      </Box>

      <Box flex={1} paddingHorizontal="xl" justifyContent="center">
        <Box alignItems="center" marginBottom="l">
          <AppImage
            source={logoIconPath}
            style={{ width: 120, height: 140 }}
            contentFit="contain"
          />
          <Text variant="header-2xl" marginTop="s">
            {t('joinSelene')}
          </Text>
        </Box>

        {/* El formulario ahora contiene toda la lógica de Google y validación */}
        <RegisterForm
          onSuccess={handleRegisterSuccess}
          onLoginPress={() => router.push('/(auth)/login')}
        />
      </Box>
    </ScreenLayout>
  );
}
