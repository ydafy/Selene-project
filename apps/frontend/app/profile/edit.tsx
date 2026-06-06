/**
 * @file app/profile/edit.tsx
 * @description /profile/edit modal — username + avatar editor.
 * Covers CONF-015 (EXTD-TASK-006). Modal route registered in app/_layout.tsx.
 */
import { useState } from 'react';
import { TouchableOpacity, Alert } from 'react-native';
import { Stack, Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../components/base';
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { AppImage } from '../../components/ui/AppImage';
import { useAuthContext } from '../../components/auth/AuthProvider';
import {
  useProfile,
  useUpdateProfile,
  useUpdateAvatar,
} from '../../core/hooks/useProfile';
import { useImageUpload } from '../../core/hooks/useImageUpload';
import { validateEditUsername } from '../../core/utils/editProfileValidation';
import { stripSettingsNamespace } from '../../core/hooks/deleteAccountHelpers';
import { Theme } from '../../core/theme';

export default function EditProfileScreen() {
  const { t } = useTranslation(['settings', 'profile', 'common']);
  const theme = useTheme<Theme>();
  const { session, loading: authLoading } = useAuthContext();
  const { pickImage, takePhoto } = useImageUpload();

  // Hooks MUST be called unconditionally — guard with `enabled` instead.
  const userId = session?.user.id ?? '';
  const { data: profile, isLoading: isLoadingProfile } = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  const updateAvatar = useUpdateAvatar();

  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [didInit, setDidInit] = useState(false);

  // One-shot initialization once the profile lands.
  if (!didInit && profile?.username) {
    setDraft(profile.username);
    setDidInit(true);
  }

  if (authLoading) return null;
  if (!session) return <Redirect href="/(tabs)/profile" />;

  const isSaving = updateProfile.isPending;
  const isAvatarBusy = updateAvatar.isPending;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processImageUpload = async (asset: any) => {
    if (!asset) return;
    try {
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
      await updateAvatar.mutateAsync({
        userId,
        base64: asset.base64,
        ext,
      });
      Toast.show({
        type: 'success',
        text1: t('settings:toasts.profileUpdatedTitle'),
        text2: t('settings:toasts.profileUpdatedMessage'),
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: t('settings:toasts.routeErrorTitle'),
        text2: t('settings:errors.updateFailed'),
      });
    }
  };

  const handleEditAvatar = () => {
    Alert.alert(
      t('profile:avatar.changeTitle'),
      t('profile:avatar.chooseOption'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('profile:avatar.camera'),
          onPress: async () => processImageUpload(await takePhoto()),
        },
        {
          text: t('profile:avatar.gallery'),
          onPress: async () => processImageUpload(await pickImage()),
        },
      ],
    );
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    const validation = validateEditUsername(trimmed);
    if (!validation.ok) {
      setError(t(`settings:${validation.errorKey}`));
      return;
    }
    setError(null);

    // No-op if unchanged → just close.
    if (trimmed === (profile?.username ?? '')) {
      router.back();
      return;
    }

    try {
      await updateProfile.mutateAsync({ username: trimmed });
      Toast.show({
        type: 'success',
        text1: t('settings:toasts.profileUpdatedTitle'),
        text2: t('settings:toasts.profileUpdatedMessage'),
      });
      router.back();
    } catch (e) {
      const key =
        (e as { errorKey?: string })?.errorKey ?? 'errors.updateFailed';
      setError(t(`settings:${stripSettingsNamespace(key)}`));
    }
  };

  return (
    <ScreenLayout>
      <Stack.Screen
        options={{ headerShown: false, presentation: 'modal' }}
      />

      {/* Header */}
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="m"
        paddingVertical="m"
      >
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="close"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialCommunityIcons
            name="close"
            size={24}
            color={theme.colors.textPrimary}
          />
        </TouchableOpacity>
        <Text variant="subheader-md" color="textPrimary">
          {t('settings:editProfile.title')}
        </Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={isSaving || isLoadingProfile}
          accessibilityLabel="save"
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text variant="body-md" color="primary" fontWeight="bold">
              {t('settings:editProfile.save')}
            </Text>
          )}
        </TouchableOpacity>
      </Box>

      {/* Avatar */}
      <Box alignItems="center" marginTop="l">
        <TouchableOpacity
          onPress={handleEditAvatar}
          disabled={isAvatarBusy}
          accessibilityLabel="edit-avatar"
        >
          <Box
            width={120}
            height={120}
            borderRadius="full"
            borderWidth={2}
            borderColor="primary"
            overflow="hidden"
            backgroundColor="background"
            justifyContent="center"
            alignItems="center"
          >
            {profile?.avatar_url ? (
              <AppImage
                source={{ uri: profile.avatar_url }}
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <MaterialCommunityIcons
                name="account"
                size={64}
                color={theme.colors.textSecondary}
              />
            )}
            {isAvatarBusy && (
              <Box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                backgroundColor="focus"
                justifyContent="center"
                alignItems="center"
              >
                <ActivityIndicator color={theme.colors.primary} />
              </Box>
            )}
          </Box>
        </TouchableOpacity>
        <Text
          variant="caption-md"
          color="primary"
          marginTop="s"
          onPress={handleEditAvatar}
        >
          {t('profile:avatar.changeTitle')}
        </Text>
      </Box>

      {/* Username field */}
      <Box paddingHorizontal="m" marginTop="xl">
        <FormTextInput
          label={t('settings:editProfile.usernameLabel')}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (error) setError(null);
          }}
          labelMode="static"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          helpTitle={t('settings:account.usernameLabel')}
          helpDescription={t('settings:account.usernameHelp')}
        />
        {error && (
          <Text variant="caption-md" color="error" marginTop="xs">
            {error}
          </Text>
        )}
      </Box>
    </ScreenLayout>
  );
}
