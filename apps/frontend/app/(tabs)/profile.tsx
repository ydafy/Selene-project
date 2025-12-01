/* eslint-disable @typescript-eslint/no-unused-vars */
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native-paper';

import { useAuthContext } from '../../components/auth/AuthProvider';
import { Box, Text } from '../../components/base';
import { AppImage } from '../../components/ui/AppImage';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { TextLink } from '../../components/ui/TextLink';
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { useAuthModal } from '../../core/auth/AuthModalProvider';

// Asumimos que tienes un ícono/ilustración para esta pantalla
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

/**
 * Componente de UI para la pantalla de bienvenida a usuarios invitados.
 * Invita al usuario a iniciar sesión o registrarse.
 */
const GuestProfile = () => {
  const { t } = useTranslation('auth');
  const { present } = useAuthModal();

  return (
    <Box flex={1} justifyContent="center" alignItems="center" padding="xl">
      <AppImage
        source={logoIconPath}
        style={{ width: 150, height: 120, marginBottom: 24 }}
        contentFit="contain"
      />
      <Text variant="header-xl" textAlign="center" marginBottom="m">
        Únete a la Comunidad Selene
      </Text>
      <Text
        variant="body-md"
        color="textSecondary"
        textAlign="center"
        marginBottom="xl"
      >
        Crea una cuenta para vender tu hardware, comprar con seguridad y guardar
        tus artículos favoritos.
      </Text>

      <PrimaryButton onPress={() => present('login')}>
        Iniciar Sesión (Modal)
      </PrimaryButton>
      <Box height={16} />
      <TextLink onPress={() => router.push('/register')}>Crear Cuenta</TextLink>
    </Box>
  );
};

/**
 * Componente de UI para la pantalla de perfil de un usuario autenticado.
 * (Actualmente es un placeholder).
 */
const UserProfile = () => {
  const { session } = useAuthContext();

  const handleLogout = async () => {
    // Aquí iría la lógica de logout completo
  };

  return (
    <Box flex={1} justifyContent="center" alignItems="center" padding="xl">
      <Text variant="subheader-lg">Bienvenido,</Text>
      <Text variant="body-md" color="textSecondary">
        {session?.user.email}
      </Text>
      {/* Aquí iría el resto del perfil del usuario... */}
    </Box>
  );
};

/**
 * Pantalla de Perfil.
 * Renderiza condicionalmente la vista de invitado o la de usuario
 * basándose en el estado de la sesión del AuthContext.
 */
export default function ProfileScreen() {
  const { session, loading } = useAuthContext();

  // Muestra un spinner mientras se carga el estado de la sesión
  if (loading) {
    return (
      <ScreenLayout>
        <Box flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator />
        </Box>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <Stack.Screen options={{ headerShown: false }} />
      {session ? <UserProfile /> : <GuestProfile />}
    </ScreenLayout>
  );
}
