import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native-paper';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile } from '../../core/hooks/useProfile';

// Hooks y Contextos
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useAuthModal } from '../../core/auth/AuthModalProvider';
import { useProfileStats } from '../../core/hooks/useProfileStats';
import { supabase } from '../../core/db/supabase';
import { useMyFavorites } from '../../core/hooks/useMyFavorites';
import { useImageUpload } from '../../core/hooks/useImageUpload';

// Componentes UI y Base
import { Box, Text } from '../../components/base';
import { AppImage } from '../../components/ui/AppImage';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { TextLink } from '../../components/ui/TextLink';
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { ProfileActionsBar } from '../../components/features/profile/ProfileActionsBar';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ProfileFavoritesGrid } from '../../components/features/profile/ProfileFavoritesGrid';

// Componentes de Feature (Perfil)
import { ProfileHeader } from '../../components/features/profile/ProfileHeader';
import { useState } from 'react';
import { theme } from '@/core/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable } from 'react-native-gesture-handler';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoIconPath = require('../../assets/images/SeleneLunaLogo.png');

/**
 * Componente de UI para la pantalla de bienvenida a usuarios invitados.
 */
const GuestProfile = () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
 * Componente de UI para el usuario autenticado.
 * Integra el nuevo Header y la lógica de datos.
 */
const UserProfile = () => {
  // 1. Hooks y Contextos
  const { t } = useTranslation(['profile', 'common', 'auth']);
  const { session } = useAuthContext();
  const queryClient = useQueryClient();

  // Datos del perfil
  const { data: stats } = useProfileStats(session?.user.id);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: profileData, isLoading: loadingProfile } = useProfile(
    session?.user.id || '',
  );
  const { data: favorites, isLoading: loadingFavs } = useMyFavorites(
    session?.user.id,
  );

  // Hook de imágenes (asegúrate de que useImageUpload exporte takePhoto)
  const { pickImage, takePhoto, uploadAvatar, uploading } = useImageUpload();

  // 2. Estado para el Diálogo de Feedback (Éxito/Error)
  const [dialogState, setDialogState] = useState({
    visible: false,
    title: '',
    message: '',
    isError: false,
  });

  const closeDialog = () =>
    setDialogState((prev) => ({ ...prev, visible: false }));

  // Objeto de perfil para la UI
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const profile = {
    username: session?.user.user_metadata.username || 'Usuario',
    avatar_url: session?.user.user_metadata.avatar_url || null,
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // 3. Lógica Central de Subida
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processImageUpload = async (imageAsset: any) => {
    if (!imageAsset || !session?.user.id) return;

    try {
      const ext = imageAsset.uri.split('.').pop()?.toLowerCase() || 'jpg';
      const publicUrl = await uploadAvatar(
        session.user.id,
        imageAsset.base64!,
        ext,
      );

      if (publicUrl) {
        // A. Actualizamos la tabla 'profiles'
        const { error: dbError } = await supabase
          .from('profiles')
          .update({ avatar_url: publicUrl })
          .eq('id', session.user.id);

        if (dbError) throw dbError;

        // B. ELIMINADO: Ya no actualizamos auth.updateUser. No es necesario y causa conflictos.

        // C. Refrescamos la caché para ver la foto nueva inmediatamente
        await queryClient.invalidateQueries({
          queryKey: ['profile', session.user.id],
        });

        setDialogState({
          visible: true,
          title: t('profile:feedback.avatarUpdatedTitle'),
          message: t('profile:feedback.avatarUpdatedMsg'),
          isError: false,
        });
      }
    } catch (error) {
      console.error('Error subiendo avatar:', error);
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
          text: t('common:cancel'),
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
  };

  const isAdmin = profileData?.role === 'admin';

  return (
    <Box flex={1} backgroundColor="background">
      {/* Usamos ScrollView para permitir desplazamiento vertical */}

      <ProfileHeader
        user={session?.user || null}
        profile={displayProfile}
        stats={stats as undefined}
        onEditAvatar={handleEditAvatar}
        onLogout={handleLogout}
        isUploading={uploading}
      />
      {isAdmin && (
        <Box paddingHorizontal="m" marginTop="m">
          <PrimaryButton
            onPress={() => router.push('/admin/dashboard')} // Ruta que crearemos luego
            icon="shield-account"
            style={{
              backgroundColor: theme.colors.primary, // Un gris oscuro distintivo
              borderWidth: 1,
              borderColor: theme.colors.primary,
            }}
            labelStyle={{ color: theme.colors.primary }} // Texto dorado
          >
            Panel de Administración
          </PrimaryButton>
        </Box>
      )}

      <Box paddingHorizontal="m" marginTop="m">
        <Pressable onPress={() => router.push('/profile/wallet')}>
          <Box
            backgroundColor="cardBackground"
            padding="m"
            borderRadius="m"
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Box flexDirection="row" alignItems="center">
              <MaterialCommunityIcons
                name="wallet"
                size={24}
                color={theme.colors.primary}
              />
              <Text variant="subheader-md" marginLeft="m">
                Mi Billetera
              </Text>
            </Box>
            <Box flexDirection="row" alignItems="center">
              <Text variant="body-md" color="primary" marginRight="s">
                {/* Aquí mostraremos el saldo rápido después */}
                {/* {formatCurrency(wallet?.available_balance || 0)} */}
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={theme.colors.textSecondary}
              />
            </Box>
          </Box>
        </Pressable>
      </Box>

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

      {/* Espacio extra al final */}
      <Box height={100} />
    </Box>
  );
};

/**
 * Pantalla Principal de Perfil.
 */
export default function ProfileScreen() {
  const { session, loading } = useAuthContext();

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
    <ScreenLayout disableSafeArea>
      <Stack.Screen options={{ headerShown: false }} />
      {session ? <UserProfile /> : <GuestProfile />}
    </ScreenLayout>
  );
}
