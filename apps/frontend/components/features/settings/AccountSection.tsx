import { useState, useEffect } from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native-paper';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../base';
import { FormTextInput } from '../../ui/FormTextInput';
import { Theme } from '../../../core/theme';
import { useUpdateProfile } from '../../../core/hooks/useProfile';
import { stripSettingsNamespace } from '../../../core/hooks/deleteAccountHelpers';

type AccountSectionProps = {
  userId: string;
  username: string | null | undefined;
  isLoading?: boolean;
};

// Letters, digits, underscore, dot. Matches spec CONF-002.
const USERNAME_REGEX = /^[A-Za-z0-9_.]+$/;

export const AccountSection = ({
  userId,
  username,
  isLoading = false,
}: AccountSectionProps) => {
  const { t } = useTranslation('settings');
  const theme = useTheme<Theme>();
  const updateProfile = useUpdateProfile(userId);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(username ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  // Sync local draft when the canonical username changes (e.g. cache refresh).
  useEffect(() => {
    if (!isEditing) {
      setDraft(username ?? '');
    }
  }, [username, isEditing]);

  const closeEditor = () => {
    setIsEditing(false);
    setDraft(username ?? '');
    setLocalError(null);
  };

  const handleSave = async () => {
    const trimmed = draft.trim();

    if (trimmed.length === 0) {
      setLocalError(t('errors.usernameRequired'));
      return;
    }
    if (trimmed.length < 3) {
      setLocalError(
        t('errors.usernameTooShort', { defaultValue: 'Mínimo 3 caracteres' }),
      );
      return;
    }
    if (trimmed.length > 20) {
      setLocalError(
        t('errors.usernameTooLong', { defaultValue: 'Máximo 20 caracteres' }),
      );
      return;
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      setLocalError(t('errors.usernameInvalid'));
      return;
    }
    if (trimmed === username) {
      closeEditor();
      return;
    }

    setLocalError(null);
    try {
      await updateProfile.mutateAsync({ username: trimmed });
      setIsEditing(false);
    } catch (error) {
      const key =
        (error as { errorKey?: string })?.errorKey ?? 'errors.updateFailed';
      // Use shared namespace-stripping helper.
      const trimmedKey = stripSettingsNamespace(key);
      setLocalError(t(trimmedKey));
    }
  };

  const isSaving = updateProfile.isPending;

  return (
    <Box>
      {isEditing ? (
        <Box paddingHorizontal="m" paddingVertical="m">
          <FormTextInput
            label={t('account.usernameLabel')}
            value={draft}
            onChangeText={setDraft}
            labelMode="static"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSaving}
            helpTitle={t('account.usernameLabel')}
            helpDescription={t('account.usernameHelp')}
          />
          {localError && (
            <Text variant="caption-md" color="error" marginTop="xs">
              {localError}
            </Text>
          )}
          <Box flexDirection="row" justifyContent="flex-end" marginTop="m">
            <TouchableOpacity
              onPress={closeEditor}
              disabled={isSaving}
              activeOpacity={0.7}
              style={{ marginRight: 16 }}
            >
              <Text variant="body-md" color="textSecondary">
                {t('account.cancel')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving}
              activeOpacity={0.7}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <Text variant="body-md" color="primary" fontWeight="bold">
                  {t('account.save')}
                </Text>
              )}
            </TouchableOpacity>
          </Box>
        </Box>
      ) : (
        <TouchableOpacity
          onPress={() => setIsEditing(true)}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          <Box
            flexDirection="row"
            alignItems="center"
            paddingVertical="m"
            paddingHorizontal="m"
          >
            <Box flex={1}>
              <Text variant="caption-md" color="textSecondary">
                {t('account.usernameLabel')}
              </Text>
              <Text variant="body-md" color="textPrimary" marginTop="xs">
                {isLoading
                  ? t('account.loading')
                  : username
                    ? `@${username}`
                    : '—'}
              </Text>
            </Box>
            <Text variant="body-md" color="primary">
              {t('account.edit')}
            </Text>
          </Box>
        </TouchableOpacity>
      )}
    </Box>
  );
};
