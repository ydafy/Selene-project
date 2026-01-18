import { useLocalSearchParams, Stack, router } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { Box, Text } from '../../components/base';
import { useProfile } from '../../core/hooks/useProfile';
import { useProfileStats } from '../../core/hooks/useProfileStats';
import { Theme } from '../../core/theme';
import { ProfileHeader } from '../../components/features/profile/ProfileHeader';
import { OptionsMenu } from '../../components/ui/OptionsMenu';

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();

  const { data: profile, isLoading, error } = useProfile(id!);
  // También cargamos las estadísticas de este usuario
  const { data: stats } = useProfileStats(id!);

  if (isLoading) {
    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor="background"
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </Box>
    );
  }

  if (error || !profile) {
    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor="background"
      >
        <Text variant="body-md" color="error">
          No se pudo cargar el perfil.
        </Text>
      </Box>
    );
  }

  return (
    <ScreenLayout>
      <Stack.Screen
        options={{
          title: '', // Quitamos título del header nativo
          headerShown: true,
          headerTransparent: true, // Hacemos transparente el header nativo
          headerTintColor: theme.colors.textPrimary,
          headerLeft: () => (
            <IconButton
              icon="arrow-left"
              iconColor={theme.colors.textPrimary}
              onPress={() => router.back()}
            />
          ),
        }}
      />

      {/* Espacio para compensar el header transparente */}
      <Box height={60} />

      <ProfileHeader
        user={null} // No tenemos el objeto User de auth, solo el perfil público
        profile={profile}
        stats={stats as undefined}
        // NO pasamos onEdit ni onLogout -> Se renderiza en modo lectura

        // Inyectamos el menú de reportar en el slot derecho
        headerRight={
          <OptionsMenu
            targetId={profile.id}
            sellerId={profile.id}
            context="user"
          />
        }
      />

      {/* Placeholder para lista de productos */}
      <Box marginTop="xl" padding="m" alignItems="center">
        <Text variant="body-md" color="textSecondary">
          (Lista de productos del vendedor próximamente)
        </Text>
      </Box>
    </ScreenLayout>
  );
}
