/**
 * @file apps/frontend/app/(auth)/login.tsx
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
import { LoginForm } from '../../components/features/auth/LoginForm';
import { Theme } from '../../core/theme';

const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

export default function LoginScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />

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
            {t('loginTitle', 'Bienvenido')}
          </Text>
        </Box>

        <LoginForm
          onSuccess={() => router.replace('/(tabs)')}
          onRegisterPress={() => router.push('/(auth)/register')}
          onForgotPasswordPress={() => router.push('/(auth)/forgotPassword')}
        />
      </Box>
    </ScreenLayout>
  );
}
