import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import * as LocalAuthentication from 'expo-local-authentication';

import { Box, Text } from '../../base';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FormTextInput } from '../../ui/FormTextInput';
import { SettingsRow } from './SettingsRow';
import { supabase } from '../../../core/db/supabase';
import { useAuthContext } from '../../../components/auth/AuthProvider';
import {
  validatePasswordChange,
  generatePasswordNonce,
  buildPasswordUpdatePayload,
} from '../../../core/utils/passwordChange';

type SecuritySectionProps = {
  disabled?: boolean;
};

export const SecuritySection = ({ disabled = false }: SecuritySectionProps) => {
  const { t } = useTranslation('settings');
  const { session } = useAuthContext();
  const isGoogleUser = session?.user?.app_metadata?.provider === 'google';

  // Logout dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Password change dialog
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const resetPwForm = () => {
    setNewPw('');
    setConfirmPw('');
    setPwError(null);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setLoading(false);
      setDialogOpen(false);
    }
  };

  const handlePwConfirm = async () => {
    const validation = validatePasswordChange(newPw, confirmPw);
    if (!validation.ok) {
      setPwError(t(validation.errorKey));
      return;
    }
    setPwError(null);
    setPwSubmitting(true);
    try {
      // Biometric gate — proves physical possession, session alone is not enough
      // for destructive account mutations. Supabase ignores currentPassword in
      // updateUser, so biometric replaces re-typing.

      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (hasHardware && isEnrolled) {
        const auth = await LocalAuthentication.authenticateAsync({
          promptMessage: t('security.biometricPrompt'),
          fallbackLabel: t('security.biometricFallback'),
        });

        if (!auth.success) {
          setPwError(t('security.biometricFailed'));
          return;
        }
      }
      const nonce = generatePasswordNonce();
      const payload = buildPasswordUpdatePayload(newPw, nonce);
      const { error } = await supabase.auth.updateUser(payload);
      if (error) throw error;

      setPwOpen(false);
      resetPwForm();
      Toast.show({
        type: 'success',
        text1: t('toasts.passwordUpdatedTitle'),
        text2: t('toasts.passwordUpdatedMessage'),
      });
    } catch (err) {
      const code = (err as { message?: string })?.message ?? '';
      const isWrong = /invalid|wrong|incorrect/i.test(code);
      setPwError(t(isWrong ? 'errors.wrongPassword' : 'errors.updateFailed'));
    } finally {
      setPwSubmitting(false);
    }
  };

  return (
    <>
      {/* Password change row (above logout, per task spec) */}
      <SettingsRow
        icon="lock-reset"
        label={t('security.passwordTitle')}
        onPress={isGoogleUser ? undefined : () => setPwOpen(true)}
        disabled={disabled}
      />
      {isGoogleUser && (
        <Box paddingHorizontal="l" paddingBottom="s">
          <Text
            variant="caption-md"
            color="textSecondary"
            opacity={0.6}
            fontStyle="italic"
          >
            {t('security.googleProviderHint')}
          </Text>
        </Box>
      )}

      <SettingsRow
        icon="logout"
        label={t('security.logout')}
        onPress={() => setDialogOpen(true)}
        disabled={disabled}
        destructive
      />

      <ConfirmDialog
        visible={dialogOpen}
        title={t('security.logoutConfirmTitle')}
        description={t('security.logoutConfirmMessage')}
        onCancel={() => setDialogOpen(false)}
        onConfirm={handleConfirm}
        confirmLabel={t('security.logoutConfirm')}
        isDangerous
        loading={loading}
        icon="logout"
      />

      <ConfirmDialog
        visible={pwOpen}
        title={t('security.passwordTitle')}
        onCancel={() => {
          setPwOpen(false);
          resetPwForm();
        }}
        onConfirm={handlePwConfirm}
        confirmLabel={t('security.passwordChangeAction')}
        loading={pwSubmitting}
        icon="lock-reset"
      >
        <Box marginTop="s">
          <FormTextInput
            label={t('security.passwordNew')}
            value={newPw}
            onChangeText={setNewPw}
            labelMode="static"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pwSubmitting}
          />
          <Box height={12} />
          <FormTextInput
            label={t('security.passwordConfirm')}
            value={confirmPw}
            onChangeText={setConfirmPw}
            labelMode="static"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pwSubmitting}
          />
          {pwError && (
            <Text variant="caption-md" color="error" marginTop="s">
              {pwError}
            </Text>
          )}
        </Box>
      </ConfirmDialog>
    </>
  );
};
