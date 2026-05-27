/**
 * @file apps/frontend/app/(auth)/verify-code.tsx
 * @description Pantalla de verificación de cuenta (OTP).
 * Procesa la validación final del registro por correo electrónico.
 */

import React, { useState, useEffect } from 'react';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import OTPTextInput from 'react-native-otp-textinput';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { TextLink } from '../../components/ui/TextLink';
import { Box, Text } from '../../components/base';
import { useAuth } from '../../core/hooks/useAuth';
import { Theme } from '../../core/theme';

export default function VerifyCodeScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useTheme<Theme>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { verifyOtp, resendSignUpOtp, loading } = useAuth();
  const { email } = useLocalSearchParams<{ email: string }>();

  const [otpCode, setOtpCode] = useState('');
  const [isResending, setIsResending] = useState(false);

  // --- 1. GUARDIÁN DE DATOS ---
  useEffect(() => {
    if (!email) {
      Toast.show({
        type: 'error',
        text1: t('common:errors.errorTitle'),
        text2: 'Falta información de correo.',
      });
      router.replace('/(auth)/register');
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
        text2: t('auth:enter6DigitCode'),
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
        text2: result.error?.message || t('common:errors.generic'),
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

    if (!result.success) {
      Toast.show({
        type: 'error',
        text1: t('auth:verificationErrorTitle'),
        text2: result.error?.message || t('common:errors.generic'),
      });
    } else {
      Toast.show({
        type: 'success',
        text1: t('auth:resendCodeSuccessTitle', 'Código reenviado'),
        text2: t('auth:resendCodeSuccessMsg', 'Revisa tu bandeja de entrada.'),
      });
    }
  };

  return (
    <ScreenLayout>
      {/* gestureEnabled: false evita que el usuario regrese por accidente sin verificar */}
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

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
            } as any
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
          justifyContent="center"
        >
          <Text color="textSecondary">{t('auth:didNotReceiveCode')} </Text>
          <TextLink onPress={handleResendCode} disabled={isResending}>
            {isResending
              ? t('common:states.loading')
              : t('auth:resendCodeLink')}
          </TextLink>
        </Box>
      </Box>
    </ScreenLayout>
  );
}
