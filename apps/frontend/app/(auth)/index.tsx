/* eslint-disable @typescript-eslint/no-explicit-any */
//--LOGIN SCREEN WITH GOOGLE SIGN-IN INTEGRATION--//

import { Alert, Image } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTheme } from '@shopify/restyle';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

// Importaciones de componentes y lógica
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { TextLink } from '../../components/ui/TextLink';
import { Box, Text } from '../../components/base';
import { useAuth, loginSchema, LoginData } from '../../core/hooks/useAuth';
import { Theme } from '../../core/theme';
import { supabase } from '../../core/db/supabase';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoPath = require('../../assets/images/logo.png');

export default function LoginScreen() {
  const { t } = useTranslation('auth');
  const { loading, setLoading } = useAuth(); // Ajustamos el hook para obtener setLoading
  const theme = useTheme<Theme>();

  // --- CAMBIO #1: OBTENER 'isValid' y CONFIGURAR EL MODO ---
  const {
    control,
    handleSubmit,
    formState: { errors, isValid }, // Obtenemos 'isValid' del estado del formulario
  } = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    mode: 'onChange', // ¡MUY IMPORTANTE! Esto recalcula la validez en cada cambio.
  });

  const onSubmit = async (data: LoginData) => {
    setLoading(true); // Usamos setLoading del hook
    const { error } = await supabase.auth.signInWithPassword(data);
    setLoading(false); // Usamos setLoading del hook

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      router.replace('/(tabs)');
    }
  };

  const onGoogleSignIn = async () => {
    setLoading(true);
    try {
      // 1. Verifica que los servicios de Google Play estén disponibles en Android.
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });

      // 2. Inicia el flujo de login nativo y obtiene la información del usuario.
      const userInfo: any = await GoogleSignin.signIn();

      console.log('Google Sign-In successful. UserInfo structure:', {
        hasIdToken: !!userInfo?.idToken,
        hasDataIdToken: !!userInfo?.data?.idToken,
        keys: userInfo ? Object.keys(userInfo) : [],
      });

      // 3. Verifica que el idToken, que es crucial para Supabase, exista.
      const idToken = userInfo?.idToken || userInfo?.data?.idToken;

      if (idToken) {
        // 4. Si existe, se lo pasamos a Supabase.
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });

        if (error) {
          // Si Supabase devuelve un error (ej. problema de configuración), lo lanzamos.
          throw error;
        }

        // Si no hay error, la sesión se establece y el hook useProtectedRoute
        // se encargará de la redirección. Forzamos un replace por si acaso.
        router.replace('/(tabs)');
      } else {
        throw new Error('No se pudo obtener el idToken de Google.');
      }
    } catch (error: unknown) {
      // --- NUEVO BLOQUE CATCH MÁS DETALLADO ---
      console.error('Error detallado en Google Sign-In:', error);

      // Log additional error details
      if (error && typeof error === 'object') {
        console.error('Error code:', (error as any).code);
        console.error('Error message:', (error as any).message);
        console.error('Error stack:', (error as any).stack);
      }

      let errorMessage = 'Ocurrió un error inesperado.';

      if (error && typeof error === 'object' && 'code' in error) {
        const googleError = error as { code: string | number };
        switch (googleError.code) {
          case statusCodes.SIGN_IN_CANCELLED:
            // Esto es normal, no mostramos alerta.
            setLoading(false);
            return;
          case statusCodes.IN_PROGRESS:
            errorMessage = 'Ya hay un inicio de sesión en progreso.';
            break;
          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            errorMessage =
              'Los servicios de Google Play no están disponibles o están desactualizados.';
            break;
          default:
            errorMessage = `Ocurrió un error con Google Sign-In. Código: ${googleError.code}`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      Alert.alert('Error', errorMessage);
      // --- FIN DEL NUEVO BLOQUE CATCH ---
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />

      <Box flex={1} paddingHorizontal="xl" justifyContent="space-between">
        <Box flex={1} justifyContent="center">
          <Image
            source={logoPath}
            style={{
              width: 120,
              height: 120,
              alignSelf: 'center',
              marginBottom: 40,
            }}
            resizeMode="contain"
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
              variant="subdued"
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
              variant="subdued"
              style={{ color: theme.colors.error, marginTop: 4, marginLeft: 8 }}
            >
              {t(errors.password.message as string)}
            </Text>
          )}

          <Box height={24} />

          {/* --- CAMBIO #2: USAR 'isValid' PARA DESHABILITAR EL BOTÓN --- */}
          <PrimaryButton
            onPress={handleSubmit(onSubmit)}
            loading={loading}
            disabled={!isValid || loading} // El botón está deshabilitado si el formulario NO es válido o si está cargando.
          >
            {t('loginButton')}
          </PrimaryButton>

          <Box flexDirection="row" alignItems="center" marginVertical="l">
            <Box flex={1} height={1} backgroundColor="cardBackground" />
            <Text variant="subdued" marginHorizontal="m">
              O
            </Text>
            <Box flex={1} height={1} backgroundColor="cardBackground" />
          </Box>
          {/* --- GOOGLE BUTTON --- */}
          <PrimaryButton
            onPress={() => onGoogleSignIn()} // Conectaremos esta función ahora
            icon="google" // React Native Paper Button puede aceptar un icono
            variant="outline" // Usaremos nuestro estilo 'outline'
          >
            Continuar con Google
          </PrimaryButton>

          <TextLink
            onPress={() => {}}
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
          <Text color="textSecondary">{t('noAccount')} </Text>
          <TextLink onPress={() => router.push('/(auth)/register')}>
            {t('signUpLink')}
          </TextLink>
        </Box>
      </Box>
    </ScreenLayout>
  );
}
