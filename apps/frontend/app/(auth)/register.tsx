/**
 * @file apps/frontend/app/(auth)/register.tsx
 * @description Pantalla de registro de usuario.
 * Contenedor de alto nivel que gestiona el layout y la navegación post-registro.
 */

import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { AuthBackButton } from '../../components/features/auth/AuthBackButton';
import { AppImage } from '../../components/ui/AppImage';
import { Box, Text } from '../../components/base';
import { RegisterForm } from '../../components/features/auth/RegisterForm';

const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

export default function RegisterScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();

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
    <ScreenLayout keyboardAware>
      <Stack.Screen options={{ headerShown: false }} />

      <AuthBackButton />

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
          onAccountExists={() => router.replace('/(auth)/login')}
          onLoginPress={() => router.push('/(auth)/login')}
        />
      </Box>
    </ScreenLayout>
  );
}
