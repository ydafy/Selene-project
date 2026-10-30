/**
 * @file apps/frontend/app/(auth)/verify-code.tsx
 * @description Pantalla de verificación de cuenta (OTP).
 * Procesa la validación final del registro por correo electrónico.
 */

import React, { useState, useEffect } from 'react';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import type { TextStyle } from 'react-native';
import OTPTextInput from 'react-native-otp-textinput';
import Toast from 'react-native-toast-message';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { AuthBackButton } from '../../components/features/auth/AuthBackButton';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { TextLink } from '../../components/ui/TextLink';
import { Box, Text } from '../../components/base';
import { useAuth } from '../../core/hooks/useAuth';
import { mapAuthErrorKey } from '../../core/auth/authErrors.logic';
import { shouldStartCooldown } from '../../core/auth/resendCooldown.logic';
import { useResendCooldown } from '../../core/auth/useResendCooldown';
import { Theme } from '../../core/theme';

export default function VerifyCodeScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useTheme<Theme>();
  const router = useRouter();

  const { verifyOtp, resendSignUpOtp, loading } = useAuth();
  const { email } = useLocalSearchParams<{ email: string }>();

  const [otpCode, setOtpCode] = useState('');
  const [isResending, setIsResending] = useState(false);
  const { seconds: cooldownSeconds, start: startCooldown } =
    useResendCooldown();

  // --- 1. GUARDIÁN DE DATOS ---
  useEffect(() => {
    if (!email) {
      Toast.show({
        type: 'error',
        text1: t('common:errors.title'),
        text2: t('auth:errors.missingEmail'),
      });
      router.replace('/(tabs)');
    }
  }, [email]);

  /**
   * Procesa la verificación del código contra Supabase.
   */
  const handleVerifyCode = async () => {
    if (!email || otpCode.length < 6) {
      Toast.show({
        type: 'error',
        text1: t('auth:verificationErrorTitle'),
        text2: t('auth:errors.enter6DigitCode'),
      });
      return;
    }

    const result = await verifyOtp(email, otpCode);

    if (result.success && result.session) {
      Toast.show({
        type: 'success',
        text1: t('auth:accountVerifiedTitle'),
        text2: t('auth:welcomeMessage'),
      });
      router.replace('/(tabs)');
    } else {
      Toast.show({
        type: 'error',
        text1: t('auth:verificationErrorTitle'),
        text2: t(result.error?.messageKey ?? mapAuthErrorKey(null)),
      });
    }
  };

  /**
   * Solicita un nuevo código de registro.
   */
  const handleResendCode = async () => {
    if (!email || isResending) return;

    setIsResending(true);
    const result = await resendSignUpOtp(email);
    setIsResending(false);
    if (shouldStartCooldown(result)) startCooldown();

    if (!result.success) {
      Toast.show({
        type: 'error',
        text1: t('auth:verificationErrorTitle'),
        text2: t(result.error?.messageKey ?? mapAuthErrorKey(null)),
      });
    } else {
      Toast.show({
        type: 'success',
        text1: t('auth:resendCodeSuccessTitle'),
        text2: t('auth:resendCodeSuccessMsg'),
      });
    }
  };

  return (
    <ScreenLayout keyboardAware>
      {/* gestureEnabled: false evita que el usuario regrese por accidente sin verificar */}
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <AuthBackButton />

      <Box flex={1} justifyContent="center" paddingHorizontal="xl">
        <Box alignItems="center" marginBottom="xl">
          <Text variant="header-2xl" marginBottom="m" textAlign="center">
            {t('auth:verifyYourEmailTitle')}
          </Text>
          <Text variant="body-md" color="textSecondary" textAlign="center">
            {t('auth:enterCodeSentTo')}{' '}
            <Text variant="body-md" fontWeight="bold" color="textPrimary">
              {email}
            </Text>
          </Text>
        </Box>

        <OTPTextInput
          handleTextChange={(val) => setOtpCode(val.trim())}
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
            } as TextStyle
          }
          containerStyle={{
            marginBottom: theme.spacing.xl,
          }}
        />

        <PrimaryButton
          onPress={handleVerifyCode}
          loading={loading}
          disabled={loading || otpCode.length < 6}
        >
          {t('auth:verifyButton')}
        </PrimaryButton>

        <Box
          marginTop="l"
          alignItems="center"
          flexDirection="row"
          flexWrap="wrap"
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
