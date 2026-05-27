/**
 * @file apps/frontend/app/(auth)/resetPassword.tsx
 * @description Pantalla final de recuperación de contraseña.
 * Valida el código OTP y permite establecer la nueva credencial de forma segura.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import OTPTextInput from 'react-native-otp-textinput';
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

// --- 1. ESQUEMA DE VALIDACIÓN ---
const getResetPasswordSchema = (t: any) =>
  z
    .object({
      password: z
        .string()
        .min(8, { message: t('auth:errors.passwordTooShort') }),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('auth:errors.passwordsDoNotMatch'),
      path: ['confirmPassword'],
    });

type ResetPasswordData = z.infer<ReturnType<typeof getResetPasswordSchema>>;

export default function ResetPasswordScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { resetPassword, loading } = useAuth();
  const { email } = useLocalSearchParams<{ email: string }>();

  const [otpCode, setOtpCode] = useState('');

  // --- 2. GUARDIÁN DE DATOS ---
  useEffect(() => {
    if (!email) {
      Toast.show({
        type: 'error',
        text1: t('common:errors.errorTitle'),
        text2: 'Falta información de correo.',
      });
      router.replace('/(auth)/forgotPassword');
    }
  }, [email]);

  const schema = useMemo(() => getResetPasswordSchema(t), [t]);

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<ResetPasswordData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (data: ResetPasswordData) => {
    if (!email) return;

    if (otpCode.length < 6) {
      Toast.show({
        type: 'error',
        text1: t('auth:verificationErrorTitle'),
        text2: t('auth:enter6DigitCode'),
      });
      return;
    }

    const result = await resetPassword(email, otpCode, data.password);

    if (result.success) {
      Toast.show({
        type: 'success',
        text1: t('auth:passwordResetSuccess'),
        text2: t('auth:welcomeMessage'),
      });
      router.replace('/(tabs)');
    } else {
      Toast.show({
        type: 'error',
        text1: t('auth:forgotPassword.errorTitle'),
        text2: result.error?.message || t('common:errors.generic'),
      });
    }
  };

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />

      {/* BOTÓN DE ATRÁS DINÁMICO */}
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
            style={{ width: 130, height: 120 }}
            contentFit="contain"
          />
          <Text variant="header-xl" marginTop="m" textAlign="center">
            {t('auth:resetPasswordTitle')}
          </Text>
          <Text
            variant="body-md"
            color="textSecondary"
            textAlign="center"
            marginTop="s"
          >
            {t('auth:resetPasswordSubtitle')}
          </Text>
        </Box>

        <Text variant="body-md" marginBottom="s">
          {t('auth:codeLabel')}
        </Text>

        <OTPTextInput
          handleTextChange={(val) => setOtpCode(val.trim())} // Sanitización básica
          inputCount={6}
          tintColor={theme.colors.primary}
          offTintColor={theme.colors.textSecondary}
          textInputStyle={
            {
              width: 35,
              height: 50,
              color: theme.colors.textPrimary,
              fontFamily: 'Montserrat-Medium',
              borderBottomWidth: 2,
              borderWidth: 0,
            } as any
          }
          containerStyle={{ marginBottom: 24 }}
        />

        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              label={t('auth:newPasswordLabel')}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              secureTextEntry
              leftIcon="lock-outline"
              error={!!errors.password}
            />
          )}
        />
        {errors.password && (
          <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
            {t(errors.password.message as string)}
          </Text>
        )}

        <Box height={16} />

        <Controller
          control={control}
          name="confirmPassword"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              label={t('auth:confirmPasswordLabel')}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              secureTextEntry
              leftIcon="lock-check-outline"
              error={!!errors.confirmPassword}
            />
          )}
        />
        {errors.confirmPassword && (
          <Text variant="body-sm" color="error" marginTop="s" marginLeft="s">
            {t(errors.confirmPassword.message as string)}
          </Text>
        )}

        <Box height={24} />

        <PrimaryButton
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          disabled={!isValid || loading || otpCode.length < 6}
        >
          {t('auth:resetButton')}
        </PrimaryButton>
      </Box>
    </ScreenLayout>
  );
}
