import { useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Alert } from 'react-native'; // Mantenemos Alert por si acaso, aunque usaremos Toast
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import OTPTextInput from 'react-native-otp-textinput';
import Toast from 'react-native-toast-message'; // <-- Usamos Toast

// Importaciones de componentes y lógica
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { TextLink } from '../../components/ui/TextLink';
import { Box, Text } from '../../components/base';
import { useAuth } from '../../core/hooks/useAuth';
import { Theme } from '../../core/theme';

export default function VerifyCodeScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme<Theme>();
  // Usamos las funciones centralizadas
  const { verifyOtp, resendSignUpOtp, loading } = useAuth();

  const { email } = useLocalSearchParams<{ email: string }>();
  const [otpCode, setOtpCode] = useState('');

  const handleVerifyCode = async () => {
    if (!email || otpCode.length < 6) {
      Toast.show({
        type: 'error',
        text1: t('verificationErrorTitle'),
        text2: t('enter6DigitCode'),
      });
      return;
    }

    const { error, session } = await verifyOtp(email, otpCode);

    if (error) {
      Toast.show({
        type: 'error',
        text1: t('verificationErrorTitle'),
        text2: error.message,
      });
    } else if (session) {
      Toast.show({
        type: 'success',
        text1: t('accountVerifiedTitle'),
        text2: t('welcomeMessage'),
      });
      router.replace('/(tabs)');
    }
  };

  const handleResendCode = async () => {
    if (!email) return;

    const { error } = await resendSignUpOtp(email);

    if (error) {
      Toast.show({
        type: 'error',
        text1: t('verificationErrorTitle'),
        text2: error.message,
      });
    } else {
      Toast.show({
        type: 'success', // O 'info' / 'seleneToast'
        text1: 'Código reenviado',
        text2:
          t('resendCodeSuccess') ||
          'Se ha enviado un nuevo código a tu correo.',
      });
    }
  };

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <Box position="absolute" top={40} left={4} zIndex={1}>
        <IconButton
          icon="arrow-left"
          iconColor={theme.colors.textPrimary}
          size={28}
          onPress={() => router.back()}
        />
      </Box>

      <Box flex={1} justifyContent="center" paddingHorizontal="xl">
        <Box alignItems="center" marginBottom="xl">
          <Text variant="header-2xl" marginBottom="m">
            {t('verifyYourEmailTitle')}
          </Text>
          <Text variant="body-md" color="textSecondary" textAlign="center">
            {t('enterCodeSentTo')}{' '}
            <Text
              variant="body-md"
              style={{ fontWeight: 'bold', color: theme.colors.textPrimary }}
            >
              {email}
            </Text>
          </Text>
        </Box>

        <OTPTextInput
          handleTextChange={setOtpCode}
          inputCount={6}
          tintColor={theme.colors.primary}
          offTintColor={theme.colors.textSecondary}
          textInputStyle={
            {
              width: 35,
              height: 54,
              color: theme.colors.textPrimary,
              fontFamily: 'Montserrat-Medium',
              borderBottomWidth: 2,
              borderWidth: 0,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          {t('verifyButton')}
        </PrimaryButton>

        <Box
          marginTop="l"
          alignItems="center"
          flexDirection="row"
          justifyContent="center"
        >
          <Text color="textSecondary">{t('didNotReceiveCode')} </Text>
          <TextLink onPress={handleResendCode}>{t('resendCodeLink')}</TextLink>
        </Box>
      </Box>
    </ScreenLayout>
  );
}
