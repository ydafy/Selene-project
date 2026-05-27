/**
 * @file apps/frontend/app/(auth)/forgotPassword.tsx
 * @description Pantalla de solicitud de recuperación de contraseña.
 * Implementa validación estricta y diseño resiliente a diferentes áreas seguras (Safe Areas).
 */

import React, { useMemo } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { z } from 'zod';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { AppImage } from '../../components/ui/AppImage';
import { Box, Text } from '../../components/base';
import { useAuth } from '../../core/hooks/useAuth';
import { Theme } from '../../core/theme';

const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

// --- 1. ESQUEMA DE VALIDACIÓN BLINDADO ---
const getForgotPasswordSchema = (t: any) =>
  z.object({
    email: z
      .string()
      .min(1, { message: t('auth:errors.emailIsRequired') })
      .email({ message: t('auth:errors.invalidEmail') })
      .trim()
      .toLowerCase(), // Normalización de datos Senior
  });

type ForgotPasswordData = z.infer<ReturnType<typeof getForgotPasswordSchema>>;

export default function ForgotPasswordScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const { sendPasswordResetOtp, loading } = useAuth();
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const schema = useMemo(() => getForgotPasswordSchema(t), [t]);

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<ForgotPasswordData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { email: '' },
  });

  const onSubmit = async (data: ForgotPasswordData) => {
    const result = await sendPasswordResetOtp(data.email);

    if (!result.success) {
      Toast.show({
        type: 'error',
        text1: t('auth:forgotPassword'),
        text2: result.error?.message || t('common:errors.generic'),
      });
    } else {
      Toast.show({
        type: 'success',
        text1: t('auth:emailSentSuccess'),
        text2: t('auth:checkYourEmail'),
      });

      // Transición suave a la siguiente fase
      router.push({
        pathname: '/(auth)/resetPassword',
        params: { email: data.email },
      });
    }
  };

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />

      {/* BOTÓN DE ATRÁS: Posicionamiento Senior basado en insets */}
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
        <Box alignItems="center" marginBottom="xl">
          <AppImage
            source={logoIconPath}
            style={{ width: 120, height: 140 }}
            contentFit="contain"
          />
          <Text variant="header-xl" marginTop="m" textAlign="center">
            {t('auth:forgotPasswordTitle')}
          </Text>
          <Text
            variant="body-md"
            color="textSecondary"
            textAlign="center"
            marginTop="s"
          >
            {t('auth:forgotPasswordSubtitle')}
          </Text>
        </Box>

        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              label={t('auth:emailLabel')}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              keyboardType="email-address"
              autoCapitalize="none"
              leftIcon="email-outline"
              error={!!errors.email}
            />
          )}
        />
        {errors.email && (
          <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
            {t(errors.email.message as string)}
          </Text>
        )}

        <Box height={24} />

        <PrimaryButton
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          disabled={!isValid || loading}
        >
          {t('auth:sendCodeButton')}
        </PrimaryButton>
      </Box>
    </ScreenLayout>
  );
}
