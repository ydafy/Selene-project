import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import * as LocalAuthentication from 'expo-local-authentication';

import { Box, Text } from '../../base';
import { FormTextInput } from '../../ui/FormTextInput';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { SettingsRow } from './SettingsRow';
import { useAuthContext } from '../../../components/auth/AuthProvider';
import { supabase } from '../../../core/db/supabase';
import {
  validateEmail,
  buildEmailUpdatePayload,
  EMAIL_REDIRECT_URL,
} from '../../../core/utils/emailChange';

type AccountSectionProps = {
  /** Current user email, used as display value on the row. */
  email?: string | null;
};

export const AccountSection = ({ email }: AccountSectionProps) => {
  const { t } = useTranslation('settings');

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState(email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);

  const { session } = useAuthContext();
  const isGoogleUser = session?.user?.app_metadata?.provider === 'google';

  const handleEmailConfirm = async () => {
    const validation = validateEmail(emailDraft);
    if (!validation.ok) {
      setEmailError(t(validation.errorKey));
      return;
    }
    setEmailError(null);
    setIsEmailSubmitting(true);
    try {
      // Biometric gate — same pattern as password change.
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHardware && isEnrolled) {
        const auth = await LocalAuthentication.authenticateAsync({
          promptMessage: t('account.biometricPrompt'),
          fallbackLabel: t('account.biometricFallback'),
        });
        if (!auth.success) {
          setEmailError(t('account.biometricFailed'));
          return;
        }
      }

      const { error } = await supabase.auth.updateUser(
        buildEmailUpdatePayload(emailDraft),
        { emailRedirectTo: EMAIL_REDIRECT_URL },
      );
      if (error) throw error;
      setEmailDialogOpen(false);
      Toast.show({
        type: 'success',
        text1: t('toasts.emailSentTitle'),
        text2: t('toasts.emailSentMessage'),
      });
    } catch (err) {
      const message = (err as { message?: string })?.message ?? '';
      if (message.includes('already')) {
        setEmailError(t('errors.emailAlreadyTaken'));
      } else {
        setEmailError(t('errors.updateFailed'));
      }
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  return (
    <Box>
      {/* Email row — disabled for Google sign-ins to prevent OAuth breakage */}
      <SettingsRow
        icon="email-outline"
        label={t('account.emailLabel')}
        description={email ?? undefined}
        onPress={isGoogleUser ? undefined : () => setEmailDialogOpen(true)}
      />
      {isGoogleUser && (
        <Box paddingHorizontal="l" paddingBottom="s">
          <Text
            variant="caption-md"
            color="textSecondary"
            opacity={0.6}
            fontStyle="italic"
          >
            {t('account.googleProviderHint')}
          </Text>
        </Box>
      )}

      <ConfirmDialog
        visible={emailDialogOpen}
        title={t('account.emailChangeTitle')}
        description={t('account.emailChangeMessage')}
        onCancel={() => {
          setEmailDialogOpen(false);
          setEmailError(null);
        }}
        onConfirm={handleEmailConfirm}
        confirmLabel={t('account.emailChangeAction')}
        loading={isEmailSubmitting}
        icon="email-edit-outline"
      >
        <Box marginTop="s">
          <FormTextInput
            label={t('account.emailLabel')}
            value={emailDraft}
            onChangeText={(text) => {
              setEmailDraft(text);
              if (emailError) setEmailError(null);
            }}
            labelMode="static"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!isEmailSubmitting}
          />
          {emailError && (
            <Text variant="caption-md" color="error" marginTop="xs">
              {emailError}
            </Text>
          )}
        </Box>
      </ConfirmDialog>
    </Box>
  );
};
