import { Alert, Image } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

// Importaciones de nuestros componentes y lógica
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { TextLink } from '../../components/ui/TextLink';
import { Box, Text } from '../../components/base';
import { useAuth, loginSchema, LoginData } from '../../core/hooks/useAuth';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoPath = require('../../assets/images/logo.png');

export default function LoginScreen() {
  // 1. Hook de traducción, especificando el namespace 'auth'
  const { t } = useTranslation('auth');

  // 2. Hook de autenticación, nos da la lógica de negocio
  const { signIn, loading, error: authError } = useAuth();

  // 3. Configuración de React Hook Form con Zod
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
  });

  // 4. Función que se llama al enviar el formulario
  const onSubmit = async (data: LoginData) => {
    const success = await signIn(data);
    if (success) {
      router.replace('/(tabs)');
    } else {
      // El hook 'useAuth' ya maneja el estado de error, pero podemos mostrar una alerta si queremos
      Alert.alert('Error', authError || 'Ocurrió un error al iniciar sesión.');
    }
  };

  return (
    <ScreenLayout style={{ justifyContent: 'space-between' }}>
      <Stack.Screen options={{ headerShown: false }} />

      <Box flex={1} justifyContent="center" paddingHorizontal="xl">
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

        {/* Usamos el componente Controller de React Hook Form para cada input */}
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
              style={{ marginBottom: 16 }}
            />
          )}
        />
        {errors.email && (
          <Text style={{ color: 'red', marginBottom: 16 }}>
            {errors.email.message}
          </Text>
        )}

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
              style={{ marginBottom: 24 }}
            />
          )}
        />
        {errors.password && (
          <Text style={{ color: 'red', marginBottom: 24 }}>
            {errors.password.message}
          </Text>
        )}

        <PrimaryButton
          onPress={handleSubmit(onSubmit)}
          loading={loading}
          disabled={loading}
        >
          {t('loginButton')}
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
    </ScreenLayout>
  );
}
