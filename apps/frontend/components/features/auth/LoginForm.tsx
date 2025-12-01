import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../base';
import { FormTextInput } from '../../ui/FormTextInput';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { GoogleButton } from '../../ui/GoogleButton';
import { TextLink } from '../../ui/TextLink';
import { useAuth, loginSchema, LoginData } from '../../../core/hooks/useAuth';
import { Theme } from '../../../core/theme';
import { supabase } from '../../../core/db/supabase';

type LoginFormProps = {
  onSuccess: () => void; // Qué hacer cuando el login funciona
  onRegisterPress: () => void; // Qué hacer al tocar "Regístrate"
  onForgotPasswordPress?: () => void;
};

export const LoginForm = ({
  onSuccess,
  onRegisterPress,
  onForgotPasswordPress,
}: LoginFormProps) => {
  const { t } = useTranslation('auth');
  const theme = useTheme<Theme>();
  const { signIn, loading, setLoading, resendSignUpOtp } = useAuth();

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    mode: 'onChange',
  });

  const onSubmit = async (data: LoginData) => {
    setLoading(true);
    try {
      const { error } = await signIn({
        email: data.email,
        password: data.password,
      });

      if (error) {
        if (error.message === 'Email not confirmed') {
          Toast.show({
            type: 'info',
            text1: 'Verificación requerida',
            text2: 'Te hemos reenviado el código a tu correo.',
          });
          await resendSignUpOtp(data.email);
          // Aquí deberíamos idealmente disparar un evento para ir a verify-code
          // Por ahora, mostramos el error
          return;
        }

        Toast.show({
          type: 'error',
          text1: t('loginErrorTitle'),
          text2: error.message,
        });
        return;
      }

      // ¡ÉXITO! Llamamos al callback del padre
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Toast.show({
        type: 'error',
        text1: t('loginErrorTitle'),
        text2: message,
      });
    } finally {
      setLoading(false);
    }
  };

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

        // ¡ÉXITO!
        onSuccess();
      } else {
        throw new Error('No se pudo obtener el idToken de Google.');
      }
    } catch (error: unknown) {
      // ... (Mismo manejo de errores de Google que tenías)
      let errorMessage = 'Ocurrió un error inesperado.';
      if (error && typeof error === 'object' && 'code' in error) {
        // ... simplificado para brevedad, usa tu lógica existente aquí
        const googleError = error as { code: string | number };
        if (googleError.code === statusCodes.SIGN_IN_CANCELLED) {
          setLoading(false);
          return;
        }
        errorMessage = `Error Google: ${googleError.code}`;
      }
      Toast.show({
        type: 'error',
        text1: t('googleSignInErrorTitle'),
        text2: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box width="100%">
      <Box height={24} />

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
            leftIcon="account-outline"
            error={!!errors.email}
          />
        )}
      />
      {errors.email && (
        <Text
          variant="body-sm"
          style={{ color: theme.colors.error, marginTop: 4, marginLeft: 8 }}
        >
          {t(errors.email.message as string)}
        </Text>
      )}

      <Box height={26} />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextInput
            label={t('passwordLabel')}
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
          style={{ color: theme.colors.error, marginTop: 4, marginLeft: 8 }}
        >
          {t(errors.password.message as string)}
        </Text>
      )}

      <Box height={26} />

      <PrimaryButton
        onPress={handleSubmit(onSubmit)}
        loading={loading}
        disabled={!isValid || loading}
      >
        {t('loginButton')}
      </PrimaryButton>

      <Box flexDirection="row" alignItems="center" marginVertical="l">
        <Box flex={1} height={1} backgroundColor="cardBackground" />
        <Text variant="body-sm" marginHorizontal="m">
          {t('or')}
        </Text>
        <Box flex={1} height={1} backgroundColor="cardBackground" />
      </Box>

      <GoogleButton onPress={onGoogleSignIn} label={t('continueWithGoogle')} />

      {onForgotPasswordPress && (
        <TextLink
          onPress={onForgotPasswordPress}
          style={{ alignSelf: 'center', marginTop: 24 }}
        >
          {t('forgotPassword')}
        </TextLink>
      )}

      <Box
        paddingVertical="l"
        alignItems="center"
        flexDirection="row"
        justifyContent="center"
      >
        <Text variant="body-md" color="textSecondary">
          {t('noAccount')}{' '}
        </Text>
        <TextLink onPress={onRegisterPress}>{t('signUpLink')}</TextLink>
      </Box>
    </Box>
  );
};
