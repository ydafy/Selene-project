import { useLocalSearchParams, Stack, router } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { IconButton } from 'react-native-paper';

import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { Box, Text } from '../../components/base';
import { AppImage } from '../../components/ui/AppImage';
import { useProfile } from '../../core/hooks/useProfile';
import { Theme } from '../../core/theme';
//import { useAuthModal } from '../../core/auth/AuthModalProvider';

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme<Theme>();
  //const { present } = useAuthModal();

  const { data: profile, isLoading, error } = useProfile(id!);

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
          title: `@${profile.username}`,
          headerShown: true,
          headerStyle: { backgroundColor: theme.colors.background },
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

      <Box alignItems="center" padding="xl">
        <AppImage
          source={
            profile.avatar_url
              ? { uri: profile.avatar_url }
              : // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('../../assets/images/SeleneLunaLogo.png')
          }
          style={{
            width: 100,
            height: 100,
            borderRadius: 50,
            marginBottom: 16,
          }}
        />
        <Text variant="header-xl">@{profile.username}</Text>
        <Text variant="body-sm" color="textSecondary" marginTop="s">
          Miembro desde {new Date(profile.created_at).toLocaleDateString()}
        </Text>

        {/* Aquí irán las pestañas de "Productos en Venta" y "Reseñas" en el futuro */}
        <Box
          marginTop="xl"
          padding="m"
          backgroundColor="cardBackground"
          borderRadius="m"
          width="100%"
        >
          <Text variant="body-md" textAlign="center" color="textSecondary">
            (Placeholder: Lista de productos y reseñas próximamente)
          </Text>
        </Box>
      </Box>
    </ScreenLayout>
  );
}
