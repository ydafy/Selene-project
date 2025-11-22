import { useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import OTPTextInput from 'react-native-otp-textinput';
import Toast from 'react-native-toast-message';
import { z } from 'zod';

// Importaciones de componentes y lógica
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { AppImage } from '../../components/ui/AppImage';
import { Box, Text } from '../../components/base';
import { useAuth } from '../../core/hooks/useAuth';
import { Theme } from '../../core/theme';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

// --- ESQUEMA DE VALIDACIÓN ---
const resetPasswordSchema = z
  .object({
    password: z.string().min(8, { message: 'auth:errors.passwordTooShort' }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'auth:errors.passwordsDoNotMatch',
    path: ['confirmPassword'],
  });

type ResetPasswordData = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme<Theme>();
  const { resetPassword, loading } = useAuth();

  // Obtenemos el email de los parámetros de navegación
  const { email } = useLocalSearchParams<{ email: string }>();

  // Estado local para el código OTP (separado del hook form para usar la librería OTP)
  const [otpCode, setOtpCode] = useState('');

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<ResetPasswordData>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onChange',
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (data: ResetPasswordData) => {
    if (!email) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Email no encontrado.',
      });
      return;
    }

    if (otpCode.length < 6) {
      Toast.show({
        type: 'error',
        text1: t('verificationErrorTitle'),
        text2: t('enter6DigitCode'),
      });
      return;
    }

    // Llamamos a la función de nuestro hook
    const { success, error } = await resetPassword(
      email,
      otpCode,
      data.password,
    );

    if (success) {
      Toast.show({
        type: 'success',
        text1: t('passwordResetSuccess'),
        text2: t('welcomeMessage'),
      });
      // Al resetear la contraseña, Supabase inicia sesión automáticamente.
      // Redirigimos a la app principal.
      router.replace('/(tabs)');
    } else {
      Toast.show({
        type: 'error',
        text1: t('registerErrorTitle'),
        text2: error?.message || 'Error al restablecer contraseña',
      });
    }
  };

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />

      <Box position="absolute" top={40} left={4} zIndex={1}>
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
            {t('resetPasswordTitle')}
          </Text>
          <Text
            variant="body-md"
            color="textSecondary"
            textAlign="center"
            marginTop="s"
          >
            {t('resetPasswordSubtitle')}
          </Text>
        </Box>

        {/* --- SECCIÓN DEL CÓDIGO OTP --- */}
        <Text
          variant="body-md"
          marginBottom="s"
          style={{ fontWeight: 'regular' }}
        >
          {t('codeLabel')}
        </Text>
        <OTPTextInput
          handleTextChange={setOtpCode}
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
          containerStyle={{ marginBottom: 24 }}
        />

        {/* --- SECCIÓN DE NUEVA CONTRASEÑA --- */}
        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              label={t('newPasswordLabel')}
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
          <Text
            variant="body-sm"
            style={{ color: theme.colors.error, marginTop: 4 }}
          >
            {t(errors.password.message as string)}
          </Text>
        )}
        <Box height={16} />

        <Controller
          control={control}
          name="confirmPassword"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              label={t('confirmPasswordLabel')}
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
          <Text
            variant="body-sm"
            style={{ color: theme.colors.error, marginTop: 4 }}
          >
            {t(errors.confirmPassword.message as string)}
          </Text>
        )}

        <Box height={24} />

        <PrimaryButton
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          // Deshabilitamos si el formulario es inválido, si está cargando O si el código OTP está incompleto
          disabled={!isValid || loading || otpCode.length < 6}
        >
          {t('resetButton')}
        </PrimaryButton>
      </Box>
    </ScreenLayout>
  );
}
