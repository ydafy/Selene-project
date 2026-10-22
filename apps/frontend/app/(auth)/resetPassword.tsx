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
import { TextLink } from '../../components/ui/TextLink';
import { useAuth } from '../../core/hooks/useAuth';
import { shouldStartCooldown } from '../../core/auth/resendCooldown.logic';
import { useResendCooldown } from '../../core/auth/useResendCooldown';
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
  const { resetPassword, sendPasswordResetOtp, loading } = useAuth();
  const { email } = useLocalSearchParams<{ email: string }>();

  const [otpCode, setOtpCode] = useState('');
  // The recovery code is single use: once verified, retries only update the password.
  const [codeVerified, setCodeVerified] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const { seconds: cooldownSeconds, start: startCooldown } =
    useResendCooldown();

  // --- 2. GUARDIÁN DE DATOS ---
  useEffect(() => {
    if (!email) {
      Toast.show({
        type: 'error',
        text1: t('common:errors.errorTitle'),
        text2: t('auth:errors.missingEmail'),
      });
      router.replace('/(auth)/forgotPassword');
    }
  }, [email]);

  // The code was just sent by the previous screen.
  useEffect(() => {
    if (email) startCooldown();
  }, [email, startCooldown]);

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

    if (!codeVerified && otpCode.length < 6) {
      Toast.show({
        type: 'error',
        text1: t('auth:recoveryErrorTitle'),
        text2: t('auth:errors.enter6DigitCode'),
      });
      return;
    }

    const result = await resetPassword(
      email,
      otpCode,
      data.password,
      codeVerified,
    );
    setCodeVerified(result.codeVerified);

    if (result.ok) {
      Toast.show({
        type: 'success',
        text1: t('auth:passwordResetSuccess'),
        text2: t('auth:welcomeMessage'),
      });
      router.replace('/(tabs)');
    } else {
      Toast.show({
        type: 'error',
        text1: t('auth:recoveryErrorTitle'),
        text2: t(result.messageKey ?? 'common:errors.generic'),
      });
    }
  };

  /**
   * Requests a new recovery code. A new code replaces the previous one, so the
   * verified state is reset.
   */
  const handleResendCode = async () => {
    if (!email || isResending) return;

    setIsResending(true);
    const result = await sendPasswordResetOtp(email);
    setIsResending(false);
    if (shouldStartCooldown(result)) startCooldown();

    if (!result.success) {
      Toast.show({
        type: 'error',
        text1: t('auth:recoveryErrorTitle'),
        text2: t(result.error?.messageKey ?? 'common:errors.generic'),
      });
    } else {
      setCodeVerified(false);
      Toast.show({
        type: 'success',
        text1: t('auth:resendCodeSuccessTitle'),
        text2: t('auth:resendCodeSuccessMsg'),
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

        {!codeVerified && (
          <>
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
          </>
        )}

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
          disabled={
            !isValid || loading || (!codeVerified && otpCode.length < 6)
          }
        >
          {t('auth:resetButton')}
        </PrimaryButton>

        <Box
          marginTop="l"
          alignItems="center"
          flexDirection="row"
          justifyContent="center"
        >
          <Text color="textSecondary">{t('auth:didNotReceiveCode')} </Text>
          <TextLink
            onPress={handleResendCode}
            disabled={isResending || cooldownSeconds > 0}
          >
            {isResending
              ? t('common:states.loading')
              : cooldownSeconds > 0
                ? t('auth:resendCodeIn', { seconds: cooldownSeconds })
                : t('auth:resendCodeLink')}
          </TextLink>
        </Box>
      </Box>
    </ScreenLayout>
  );
}
