/* eslint-disable @typescript-eslint/no-explicit-any */
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Toast from 'react-native-toast-message'; // <-- Volvemos a Toast

// Importaciones de componentes y lógica
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GoogleButton } from '../../components/ui/GoogleButton';
import { TextLink } from '../../components/ui/TextLink';
import { Box, Text } from '../../components/base';
import { useAuth, loginSchema, LoginData } from '../../core/hooks/useAuth';
import { Theme } from '../../core/theme';
import { supabase } from '../../core/db/supabase';
import { AppImage } from '../../components/ui/AppImage';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoPath = require('../../assets/images/selenelogo1.png'); // Asegúrate de que sea el logo correcto

export default function LoginScreen() {
  const { t } = useTranslation('auth');
  // Usamos las funciones centralizadas del hook
  const { signIn, loading, setLoading, resendSignUpOtp } = useAuth();
  const theme = useTheme<Theme>();

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
        // Manejo especial para email no confirmado
        if (error.message === 'Email not confirmed') {
          Toast.show({
            type: 'info', // Usamos info o nuestro seleneToast
            text1: 'Verificación requerida',
            text2: 'Te hemos reenviado el código a tu correo.',
          });

          await resendSignUpOtp(data.email);

          router.push({
            pathname: '/(auth)/verify-code',
            params: { email: data.email },
          });
          return;
        }

        // Error genérico de login
        Toast.show({
          type: 'error',
          text1: t('loginErrorTitle') || 'Error de inicio de sesión',
          text2: error.message,
        });
        return;
      }

      // Éxito
      router.replace('/(tabs)');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Toast.show({
        type: 'error',
        text1: t('loginErrorTitle') || 'Error',
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

      const userInfo: any = await GoogleSignin.signIn();

      // Verificación defensiva del idToken
      const idToken = userInfo?.idToken || userInfo?.data?.idToken;

      if (idToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });

        if (error) throw error;

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
            return; // Usuario canceló, no hacemos nada
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
        text1: t('googleSignInErrorTitle') || 'Error de Google',
        text2: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />

      <Box flex={1} paddingHorizontal="xl" justifyContent="space-between">
        <Box flex={1} justifyContent="center">
          <AppImage
            source={logoPath}
            style={{
              width: 320, // Ajustado para logo-full horizontal
              height: 140,
              alignSelf: 'center',
              marginBottom: 40,
            }}
            contentFit="contain"
          />

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

          <Box height={16} />

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

          <Box height={24} />

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

          <GoogleButton
            onPress={onGoogleSignIn}
            label={t('auth:continueWithGoogle')}
          />

          <TextLink
            onPress={() => router.push('/(auth)/forgotPassword')}
            style={{ alignSelf: 'center', marginTop: 24 }}
          >
            {t('forgotPassword')}
          </TextLink>
        </Box>

        <Box
          paddingBottom="xl"
          alignItems="center"
          flexDirection="row"
          justifyContent="center"
        >
          <Text variant="body-md" color="textSecondary">
            {t('noAccount')}{' '}
          </Text>
          <TextLink onPress={() => router.push('/(auth)/register')}>
            {t('signUpLink')}
          </TextLink>
        </Box>
      </Box>
    </ScreenLayout>
  );
}
