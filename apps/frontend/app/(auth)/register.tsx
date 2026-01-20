import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import { type TextInput as RNTextInput } from 'react-native';
import { IconButton } from 'react-native-paper';
import { useRef } from 'react';
import Toast from 'react-native-toast-message';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

// Importaciones de componentes y lógica
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { AppImage } from '../../components/ui/AppImage';
import { Checkbox } from '../../components/ui/Checkbox';
import { TextLink } from '../../components/ui/TextLink';
import { GoogleButton } from '../../components/ui/GoogleButton'; // <-- NUEVO
import { Box, Text } from '../../components/base';
import {
  useAuth,
  registerSchema,
  RegisterData,
} from '../../core/hooks/useAuth';
import { Theme } from '../../core/theme';
import { supabase } from '../../core/db/supabase'; // <-- NUEVO

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

export default function RegisterScreen() {
  const { t } = useTranslation('auth');
  // Necesitamos setLoading para el botón de Google
  const { signUp, loading, setLoading } = useAuth();
  const theme = useTheme<Theme>();

  const emailInputRef = useRef<RNTextInput>(null);
  const passwordInputRef = useRef<RNTextInput>(null);
  const confirmPasswordInputRef = useRef<RNTextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      termsAccepted: false,
    },
  });

  const onSubmit = async (data: RegisterData) => {
    const { success, error, session, user } = await signUp(data);

    // Simplificamos la condición de error
    if (!success || error) {
      Toast.show({
        type: 'error',
        text1: t('registerErrorTitle'),
        text2: error?.message || 'Ocurrió un error inesperado.',
      });
      return;
    }

    if (session) {
      reset();
      router.replace('/(tabs)');
      return;
    }

    if (user) {
      reset();
      router.replace({
        pathname: '/(auth)/verify-code',
        params: { email: data.email },
      });
    }
  };

  // --- LÓGICA DE GOOGLE SIGN-IN (Reutilizada de Login) ---
  const onGoogleSignIn = async () => {
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userInfo: any = await GoogleSignin.signIn();
      const idToken = userInfo?.idToken || userInfo?.data?.idToken;

      if (idToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });

        if (error) throw error;

        // Si es exitoso, redirigimos directamente al home
        router.replace('/(tabs)');
      } else {
        throw new Error('No se pudo obtener el idToken de Google.');
      }
    } catch (error: unknown) {
      console.error('Error detallado en Google Sign-In:', error);
      let errorMessage = 'Ocurrió un error inesperado.';

      if (error && typeof error === 'object' && 'code' in error) {
        const googleError = error as { code: string | number };
        switch (googleError.code) {
          case statusCodes.SIGN_IN_CANCELLED:
            setLoading(false);
            return;
          case statusCodes.IN_PROGRESS:
            errorMessage = 'Ya hay un inicio de sesión en progreso.';
            break;
          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            errorMessage = 'Los servicios de Google Play no están disponibles.';
            break;
          default:
            errorMessage = `Error de Google: ${googleError.code}`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      Toast.show({
        type: 'error',
        text1: t('googleSignInErrorTitle') || 'Error',
        text2: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const renderTermsLabel = () => (
    <Text
      variant="body-md"
      style={{ flexShrink: 1, color: theme.colors.textSecondary }}
    >
      {t('iHaveReadAndAccept')}{' '}
      <TextLink
        onPress={() => {
          /* Navegar a Términos */
        }}
      >
        {t('termsAndConditions')}
      </TextLink>{' '}
      {t('andThe')}{' '}
      <TextLink
        onPress={() => {
          /* Navegar a Privacidad */
        }}
      >
        {t('privacyPolicy')}
      </TextLink>
      .
    </Text>
  );

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

      <Box flex={1} paddingHorizontal="xl" justifyContent="space-between">
        <Box>
          <Box alignItems="center" marginTop="xl" marginBottom="l">
            <AppImage
              source={logoIconPath}
              style={{ width: 120, height: 170 }}
              contentFit="contain"
            />
            <Text variant="header-2xl" marginTop="s">
              {t('joinSelene')}
            </Text>
          </Box>

          <Controller
            control={control}
            name="username"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormTextInput
                label={t('usernameLabel')}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                autoCapitalize="none"
                leftIcon="account-circle-outline"
                error={!!errors.username}
                autoFocus
                returnKeyType="next"
                onSubmitEditing={() => emailInputRef.current?.focus()}
              />
            )}
          />
          {errors.username && (
            <Text
              variant="body-sm"
              style={{ color: theme.colors.error, marginTop: 4 }}
            >
              {t(errors.username.message as string)}
            </Text>
          )}
          <Box height={16} />

          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormTextInput
                ref={emailInputRef}
                label={t('emailLabel')}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                keyboardType="email-address"
                autoCapitalize="none"
                leftIcon="email-outline"
                error={!!errors.email}
                returnKeyType="next"
                onSubmitEditing={() => passwordInputRef.current?.focus()}
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
          <Box height={16} />

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormTextInput
                ref={passwordInputRef}
                label={t('passwordLabel')}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                secureTextEntry
                leftIcon="lock-outline"
                error={!!errors.password}
                returnKeyType="next"
                onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
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
                ref={confirmPasswordInputRef}
                label={t('confirmPasswordLabel')}
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                secureTextEntry
                leftIcon="lock-check-outline"
                error={!!errors.confirmPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit(onSubmit)}
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
          <Controller
            control={control}
            name="termsAccepted"
            render={({ field: { onChange, value } }) => (
              <Checkbox
                status={value ? 'checked' : 'unchecked'}
                onPress={() => onChange(!value)}
                label={renderTermsLabel()}
              />
            )}
          />
          {errors.termsAccepted && (
            <Text
              variant="body-sm"
              style={{ color: theme.colors.error, marginTop: 4 }}
            >
              {t(errors.termsAccepted.message as string)}
            </Text>
          )}
        </Box>

        <Box paddingBottom="xl" paddingTop="l">
          <PrimaryButton
            onPress={handleSubmit(onSubmit)}
            loading={loading}
            disabled={!isValid || loading}
          >
            {t('createAccountButton')}
          </PrimaryButton>

          <Box flexDirection="row" alignItems="center" marginVertical="l">
            <Box flex={1} height={1} backgroundColor="cardBackground" />
            <Text variant="body-sm" marginHorizontal="m">
              {t('or')}
            </Text>
            <Box flex={1} height={1} backgroundColor="cardBackground" />
          </Box>

          <GoogleButton
            onPress={onGoogleSignIn}
            label={t('auth:continueWithGoogle')}
          />
        </Box>
      </Box>
    </ScreenLayout>
  );
}
