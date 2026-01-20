import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { z } from 'zod';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { AppImage } from '../../components/ui/AppImage';
import { Box, Text } from '../../components/base';
import { useAuth } from '../../core/hooks/useAuth';
import { Theme } from '../../core/theme';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

// Esquema simple solo para el email
const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'auth:errors.emailIsRequired' })
    .email({ message: 'auth:errors.invalidEmail' }),
});

type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordScreen() {
  const { t } = useTranslation('auth');
  const { sendPasswordResetOtp, loading } = useAuth();
  const theme = useTheme<Theme>();

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<ForgotPasswordData>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onChange',
    defaultValues: { email: '' },
  });

  const onSubmit = async (data: ForgotPasswordData) => {
    const { error } = await sendPasswordResetOtp(data.email);

    if (error) {
      Toast.show({
        type: 'error',
        text1: t('registerErrorTitle'), // Reutilizamos título de error
        text2: error.message,
      });
    } else {
      Toast.show({
        type: 'success',
        text1: t('emailSentSuccess'),
        text2: t('checkYourEmail'), // Asegúrate de añadir esta clave o usar un texto fijo
      });

      // Navegamos a la pantalla de reset, pasando el email
      router.push({
        pathname: '/(auth)/resetPassword',
        params: { email: data.email },
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
        <Box alignItems="center" marginBottom="xl">
          <AppImage
            source={logoIconPath}
            style={{ width: 120, height: 140 }}
            contentFit="contain"
          />
          <Text variant="header-xl" marginTop="m" textAlign="center">
            {t('forgotPasswordTitle')}
          </Text>
          <Text
            variant="body-md"
            color="textSecondary"
            textAlign="center"
            marginTop="s"
          >
            {t('forgotPasswordSubtitle')}
          </Text>
        </Box>

        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextInput
              label={t('emailLabel')}
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
          <Text
            variant="body-sm"
            style={{ color: theme.colors.error, marginTop: 4 }}
          >
            {t(errors.email.message as string)}
          </Text>
        )}

        <Box height={24} />

        <PrimaryButton
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          disabled={!isValid || loading}
        >
          {t('sendCodeButton')}
        </PrimaryButton>
      </Box>
    </ScreenLayout>
  );
}
