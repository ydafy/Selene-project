import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native-paper';
import { Alert } from 'react-native';

import {
  useProfile,
  useUpdateAvatar,
} from '@/features/profile/hooks/use-profile';

// Hooks y Contextos
import { useAuthContext } from '@/shared/lib/auth/auth-provider';
import { useAuthModal } from '@/shared/lib/auth/auth-modal-context';

import { useMyFavorites } from '@/features/profile/hooks/use-my-favorites';
import { useImageUpload } from '@/shared/hooks/use-image-upload';

// Componentes UI y Base
import { Box, Text } from '@/shared/ui/base';
import { AppImage } from '@/shared/ui/app-image';
import { PrimaryButton } from '@/shared/ui/button/primary-button';
import { TextLink } from '@/shared/ui/button/text-link';
import { ScreenLayout } from '@/shared/ui/layout/screen-layout';
import { ProfileActionsBar } from '@/features/profile/components/profile-actions-bar';
import { ConfirmDialog } from '@/shared/ui/feedback/confirm-dialog';
import { ProfileFavoritesGrid } from '@/features/profile/components/profile-favorites-grid';
import { ProfileSkeleton } from '@/features/profile/components/profile-skeleton';
import { ConnectIncompleteBanner } from '@/features/profile/components/connect-incomplete-banner';

// Componentes de Feature (Perfil)
import { ProfileHeader } from '@/features/profile/components/profile-header';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTabDockMetrics } from '@/shared/config/layout';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoIconPath = require('@/assets/images/SeleneLunaLogo.png');

/**
 * Componente de UI para la pantalla de bienvenida a usuarios invitados.
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
        {t('auth:guestScreen.joinSelene')}
      </Text>
      <Text
        variant="body-md"
        color="textSecondary"
        textAlign="center"
        marginBottom="xl"
      >
        {t('auth:guestScreen.joinMsg')}
      </Text>

      <PrimaryButton onPress={() => present('login')}>
        {t('auth:guestScreen.loginText')}
      </PrimaryButton>
      <Box height={16} />
      <TextLink onPress={() => present('register')}>
        {t('auth:guestScreen.createAccountText')}
      </TextLink>
    </Box>
  );
};

/**
 * Componente de UI para el usuario autenticado.
 * Integra el nuevo Header y la lógica de datos.
 */
const UserProfile = () => {
  // 1. Hooks y Contextos
  const { t } = useTranslation(['profile', 'common', 'auth']);
  const { session } = useAuthContext();

  // Datos del perfil

  const { data: profileData, isLoading: isLoadingProfile } = useProfile(
    session?.user.id || '',
  );
  const { data: favorites, isLoading: loadingFavs } = useMyFavorites(
    session?.user.id,
  );
  const updateAvatar = useUpdateAvatar();
  const { pickImage, takePhoto } = useImageUpload();

  // 2. Estado para el Diálogo de Feedback (Éxito/Error)
  const [dialogState, setDialogState] = useState({
    visible: false,
    title: '',
    message: '',
    isError: false,
  });

  if (isLoadingProfile || !profileData) {
    return <ProfileSkeleton />;
  }

  const closeDialog = () =>
    setDialogState((prev) => ({ ...prev, visible: false }));

  const handleOpenSettings = () => {
    router.push('/profile/settings');
  };

  const handleEditProfile = () => {
    router.push('/profile/edit');
  };

  // 3. Lógica Central de Subida
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processImageUpload = async (imageAsset: any) => {
    if (!imageAsset || !session?.user.id) return;

    try {
      const ext = imageAsset.uri.split('.').pop()?.toLowerCase() || 'jpg';

      // Llamamos a la mutación (Toda la lógica de Supabase ya no está aquí)
      await updateAvatar.mutateAsync({
        userId: session.user.id,
        base64: imageAsset.base64,
        ext,
      });

      setDialogState({
        visible: true,
        title: t('profile:feedback.avatarUpdatedTitle'),
        message: t('profile:feedback.avatarUpdatedMsg'),
        isError: false,
      });
    } catch (error) {
      console.error('Error en la subida de avatar:', error);
      setDialogState({
        visible: true,
        title: t('profile:feedback.avatarErrorTitle'),
        message: t('profile:feedback.avatarErrorMsg'),
        isError: true,
      });
    }
  };

  // 4. Manejador del Botón de Edición (Menú de Selección)
  const handleEditAvatar = () => {
    // Usamos Alert nativo para la selección porque es el patrón estándar de UI móvil
    // para elegir entre opciones del sistema (Cámara vs Galería).
    Alert.alert(
      t('profile:avatar.changeTitle'),
      t('profile:avatar.chooseOption'),
      [
        {
          text: t('common:dialog.cancel'),
          style: 'cancel',
        },
        {
          text: t('profile:avatar.camera'),
          onPress: async () => {
            const img = await takePhoto();
            if (img) processImageUpload(img);
          },
        },
        {
          text: t('profile:avatar.gallery'),
          onPress: async () => {
            const img = await pickImage();
            if (img) processImageUpload(img);
          },
        },
      ],
    );
  };

  // Si profileData aún carga, usamos la sesión como fallback temporal o mostramos loading
  const displayProfile = profileData || {
    username: session?.user.user_metadata.username || 'Usuario',
    avatar_url: session?.user.user_metadata.avatar_url || null,
    created_at: session?.user.created_at || new Date().toISOString(),
    id: session?.user.id || '',
    is_verified_seller: false,
  };

  return (
    <Box flex={1} backgroundColor="background">
      {/* Usamos ScrollView para permitir desplazamiento vertical */}

      <ProfileHeader
        user={session?.user || null}
        profile={displayProfile}
        onEditAvatar={handleEditAvatar}
        onSettingsPress={handleOpenSettings}
        onEditProfile={handleEditProfile}
        isUploading={updateAvatar.isPending}
      />

      <ConnectIncompleteBanner />

      <ProfileActionsBar />

      {/* 2. Renderizamos el Grid de Favoritos */}
      <ProfileFavoritesGrid
        favorites={favorites || []}
        isLoading={loadingFavs}
      />

      <ConfirmDialog
        visible={dialogState.visible}
        title={dialogState.title}
        description={dialogState.message}
        onConfirm={closeDialog} // El botón principal cierra el diálogo
        onCancel={closeDialog} // Tocar fuera también cierra
        hideCancel={true} // <-- MODO ALERTA (Un solo botón)
        confirmLabel={t('feedback.understood')}
        icon={
          dialogState.isError ? 'alert-circle-outline' : 'check-circle-outline'
        }
        isDangerous={dialogState.isError}
      />
    </Box>
  );
};

/**
 * Pantalla Principal de Perfil.
 */
export default function ProfileScreen() {
  const { session, loading } = useAuthContext();
  const insets = useSafeAreaInsets();
  const dockMetrics = getTabDockMetrics(insets.bottom);

  if (loading) {
    return (
      <ScreenLayout disableSafeArea>
        <Box flex={1} justifyContent="center" alignItems="center">
          <ActivityIndicator />
        </Box>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout
      disableSafeArea
      style={{ paddingBottom: dockMetrics.contentBottomClearance }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      {session ? <UserProfile /> : <GuestProfile />}
    </ScreenLayout>
  );
}
