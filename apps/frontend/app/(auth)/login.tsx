/**
 * @file apps/frontend/app/(auth)/login.tsx
 */

import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { AuthBackButton } from '../../components/features/auth/AuthBackButton';
import { AppImage } from '../../components/ui/AppImage';
import { Box, Text } from '../../components/base';
import { LoginForm } from '../../components/features/auth/LoginForm';

const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

export default function LoginScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();

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
            {t('loginTitle', 'Bienvenido')}
          </Text>
        </Box>

        <LoginForm
          onSuccess={() => router.replace('/(tabs)')}
          onEmailNotConfirmed={(email) =>
            router.replace({
              pathname: '/(auth)/verify-code',
              params: { email },
            })
          }
          onRegisterPress={() => router.push('/(auth)/register')}
          onForgotPasswordPress={() => router.push('/(auth)/forgotPassword')}
        />
      </Box>
    </ScreenLayout>
  );
}
