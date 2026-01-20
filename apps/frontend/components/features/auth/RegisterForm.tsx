import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import { type TextInput as RNTextInput } from 'react-native';
import Toast from 'react-native-toast-message';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { Box, Text } from '../../base';
import { FormTextInput } from '../../ui/FormTextInput';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { GoogleButton } from '../../ui/GoogleButton';
import { Checkbox } from '../../ui/Checkbox';
import { TextLink } from '../../ui/TextLink';
import {
  useAuth,
  registerSchema,
  RegisterData,
} from '../../../core/hooks/useAuth';
import { Theme } from '../../../core/theme';
import { supabase } from '../../../core/db/supabase';
import { router } from 'expo-router';

type RegisterFormProps = {
  onSuccess: (email: string) => void; // Pasamos el email para la verificación
  onLoginPress: () => void;
};

export const RegisterForm = ({
  onSuccess,
  onLoginPress,
}: RegisterFormProps) => {
  const { t } = useTranslation('auth');
  const { signUp, loading, setLoading } = useAuth();
  const theme = useTheme<Theme>();

  const emailInputRef = useRef<RNTextInput>(null);
  const passwordInputRef = useRef<RNTextInput>(null);
  const confirmPasswordInputRef = useRef<RNTextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
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

    if (!success || error) {
      Toast.show({
        type: 'error',
        text1: t('registerErrorTitle'),
        text2: error?.message || 'Error',
      });
      return;
    }

    // Éxito: Usuario creado, necesita verificación
    if (user || session) {
      // Llamamos al callback con el email para que el padre decida qué hacer (ir a OTP)
      onSuccess(data.email);
    }
  };

  // ... (Lógica de onGoogleSignIn idéntica a LoginForm, omitida por brevedad pero DEBE ir aquí)
  // Puedes copiarla del LoginForm o crear un hook useGoogleLogin para no repetir.
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
    <Box width="100%">
      {/* ... (Todos los Controllers del formulario: Username, Email, Password, Confirm, Checkbox) ... */}
      {/* Copia el JSX de los inputs de tu register.tsx original y pégalos aquí */}

      <Box>
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

      {/* Botón Principal */}
      <Box paddingVertical="m">
        <PrimaryButton
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          disabled={!isValid || loading}
        >
          {t('createAccountButton')}
        </PrimaryButton>
      </Box>

      {/* Google y Login Link */}
      <Box flexDirection="row" alignItems="center" marginBottom="l">
        <Box flex={1} height={1} backgroundColor="cardBackground" />
        <Text variant="body-sm" marginHorizontal="m">
          {t('or')}
        </Text>
        <Box flex={1} height={1} backgroundColor="cardBackground" />
      </Box>

      <GoogleButton onPress={onGoogleSignIn} label={t('continueWithGoogle')} />

      <Box
        paddingVertical="l"
        alignItems="center"
        flexDirection="row"
        justifyContent="center"
      >
        <Text variant="body-md" color="textSecondary">
          {t('alreadyHaveAccount')}{' '}
        </Text>
        {/* Asegúrate de tener la traducción 'alreadyHaveAccount' ("¿Ya tienes cuenta?") */}
        <TextLink onPress={onLoginPress}>{t('loginButton')}</TextLink>
      </Box>
    </Box>
  );
};
