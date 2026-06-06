import { TouchableOpacity } from 'react-native';
import { IconButton, ActivityIndicator } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';

import { User } from '@supabase/supabase-js';

import { Box, Text } from '../../base';
import { AppImage } from '../../ui/AppImage';
import { Theme } from '../../../core/theme';
import { ProfileStats } from '../../../core/hooks/useProfileStats';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type ProfileHeaderProps = {
  user?: User | null;
  profile: {
    username: string | null;
    avatar_url: string | null;
    created_at?: string | null;
    is_verified_seller?: boolean | null;
  } | null;
  stats?: ProfileStats;
  isUploading?: boolean;

  // Acciones (Opcionales - Si existen, es "Mi Perfil")
  onEditAvatar?: () => void;
  /**
   * Tap on the cog icon. Used to open the Settings screen.
   * Replaces the previous `onLogout` behavior which was misleading UX.
   */
  onSettingsPress?: () => void;
  /**
   * Opens the `/profile/edit` modal. Only rendered for "Mi Perfil"
   * (i.e. when defined). Covers CONF-015 entry point.
   */
  onEditProfile?: () => void;

  // Slot para acciones extras (Ej. Menú de Reportar en perfil público)
  headerRight?: React.ReactNode;
};

export const ProfileHeader = ({
  user,
  profile,
  stats,
  onEditAvatar,
  onSettingsPress,
  onEditProfile,
  headerRight,
  isUploading = false,
}: ProfileHeaderProps) => {
  const theme = useTheme<Theme>();

  // Calculamos iniciales y fecha
  const initials = profile?.username
    ? profile.username.slice(0, 2).toUpperCase()
    : 'US';

  // La fecha puede venir de 'user.created_at' (Mi Perfil) o 'profile.created_at' (Perfil Público)
  const dateString = user?.created_at || profile?.created_at;
  const joinDate = dateString ? new Date(dateString).toLocaleDateString() : '';

  const StatBox = ({
    label,
    value,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    icon,
  }: {
    label: string;
    value: string | number;
    icon: string;
  }) => (
    <Box alignItems="center" flex={1}>
      <Text
        variant="header-xl"
        color="primary"
        style={{ fontFamily: 'Montserrat-Bold' }}
      >
        {value}
      </Text>
      <Text variant="caption-md" color="textPrimary" marginTop="xs">
        {label}
      </Text>
    </Box>
  );

  // Determinamos si es editable
  const isEditable = !!onEditAvatar;

  return (
    <Box
      marginHorizontal="m"
      padding="l"
      marginTop="xl"
      backgroundColor="cardBackground"
      borderRadius="l"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
      }}
    >
      {/* --- ZONA SUPERIOR DERECHA (Acciones) --- */}
      <Box
        position="absolute"
        top={10}
        right={10}
        zIndex={1}
        flexDirection="row"
      >
        {/* Slot dinámico (para menú de reportar) */}
        {headerRight}

        {/* Botón de Ajustes (Solo si se pasa la función) */}
        {onSettingsPress && (
          <IconButton
            icon="cog-outline"
            iconColor={theme.colors.textSecondary}
            onPress={onSettingsPress}
            accessibilityLabel="settings"
          />
        )}
      </Box>

      {/* --- AVATAR --- */}
      <Box alignItems="center" marginTop="m">
        <TouchableOpacity
          onPress={onEditAvatar}
          activeOpacity={0.8}
          // Deshabilitamos el botón si ya está subiendo
          disabled={!isEditable || isUploading}
        >
          <Box
            width={100}
            height={100}
            borderRadius="full"
            borderWidth={2}
            borderColor="primary"
            justifyContent="center"
            alignItems="center"
            backgroundColor="background"
            overflow="hidden"
          >
            {/* Imagen o Iniciales */}
            {profile?.avatar_url ? (
              <AppImage
                source={{ uri: profile.avatar_url }}
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <Text variant="header-xl" color="textSecondary">
                {initials}
              </Text>
            )}

            {/* --- CAPA DE CARGA (SPINNER) --- */}
            {isUploading && (
              <Box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                backgroundColor="focus" // Fondo oscuro semitransparente
                justifyContent="center"
                alignItems="center"
                zIndex={2}
              >
                <ActivityIndicator color={theme.colors.primary} size="small" />
              </Box>
            )}

            {/* Overlay de Cámara (Solo si es editable y NO está cargando) */}
            {isEditable && !isUploading && (
              <Box
                position="absolute"
                bottom={0}
                left={0}
                right={0}
                height={30}
                backgroundColor="focus"
                justifyContent="center"
                alignItems="center"
                zIndex={1}
              >
                <IconButton
                  icon="camera"
                  iconColor="white"
                  size={14}
                  style={{ margin: 0 }}
                />
              </Box>
            )}
          </Box>
        </TouchableOpacity>

        {/* Info de Texto */}
        <Box alignItems="center" marginTop="m">
          {/* FILA DEL NOMBRE + ICONO */}
          <Box flexDirection="row" alignItems="center">
            <Text variant="header-xl">@{profile?.username || 'Usuario'}</Text>

            {/* SELLO DE VERIFICACIÓN (MVP++) */}
            {profile?.is_verified_seller && (
              <MaterialCommunityIcons
                name="check-decagram"
                size={22}
                color={theme.colors.primary}
                style={{ marginLeft: 8 }}
              />
            )}
          </Box>

          {/* TEXTO DE RESPALDO (Solo si es VIP) */}
          {profile?.is_verified_seller && (
            <Text
              variant="caption-md"
              color="primary"
              fontWeight="bold"
              marginTop="xs"
            >
              Vendedor Verificado por Selene
            </Text>
          )}

          <Text
            variant="caption-md"
            color="textSecondary"
            marginTop={profile?.is_verified_seller ? 'xs' : 's'}
          >
            Miembro desde {joinDate}
          </Text>

          {/* Editar perfil CTA (only on "Mi Perfil") */}
          {onEditProfile && (
            <TouchableOpacity
              onPress={onEditProfile}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="edit-profile"
              style={{ marginTop: 12 }}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                paddingVertical="s"
                paddingHorizontal="m"
                borderRadius="m"
                backgroundColor="background"
              >
                <MaterialCommunityIcons
                  name="pencil-outline"
                  size={16}
                  color={theme.colors.primary}
                />
                <Text
                  variant="body-md"
                  color="primary"
                  marginLeft="s"
                  fontWeight="bold"
                >
                  Editar perfil
                </Text>
              </Box>
            </TouchableOpacity>
          )}
        </Box>
      </Box>

      {/* --- ESTADÍSTICAS --- */}
      <Box
        flexDirection="row"
        marginTop="xl"
        paddingTop="l"
        borderTopWidth={1}
        borderTopColor="background"
      >
        <StatBox label="Ventas" value={stats?.sales_count || 0} icon="tag" />
        <Box
          width={1}
          height="80%"
          backgroundColor="background"
          alignSelf="center"
        />
        <StatBox
          label="Rating"
          value={stats?.rating_average?.toFixed(1) || 'N/A'}
          icon="star"
        />
        <Box
          width={1}
          height="80%"
          backgroundColor="background"
          alignSelf="center"
        />
        <StatBox
          label="Reseñas"
          value={stats?.reviews_count || 0}
          icon="message"
        />
      </Box>
    </Box>
  );
};
