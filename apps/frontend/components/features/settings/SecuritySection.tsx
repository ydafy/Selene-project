import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../base';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FormTextInput } from '../../ui/FormTextInput';
import { SettingsRow } from './SettingsRow';
import { supabase } from '../../../core/db/supabase';
import { signOutUser } from '../../../core/auth/signOut';
import { useAuthContext } from '../../../components/auth/AuthProvider';
import {
  validatePasswordChange,
  buildPasswordUpdatePayload,
  mapPasswordChangeErrorKey,
  passwordErrorField,
  type PasswordField,
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
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwErrors, setPwErrors] = useState<
    Partial<Record<PasswordField, string>>
  >({});
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const resetPwForm = () => {
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setPwErrors({});
  };

  const handleConfirm = async () => {
    setLoading(true);
    const { success } = await signOutUser();
    setLoading(false);
    setDialogOpen(false);
    if (!success) {
      Toast.show({ type: 'error', text1: t('errors.signOutFailed') });
    }
  };

  // Each error renders under the field that failed (L62).
  const showPwError = (errorKey: string) =>
    setPwErrors({ [passwordErrorField(errorKey)]: t(errorKey) });

  const handlePwConfirm = async () => {
    const validation = validatePasswordChange(currentPw, newPw, confirmPw);
    if (!validation.ok) {
      showPwError(validation.errorKey);
      return;
    }
    setPwErrors({});
    setPwSubmitting(true);
    try {
      // The server verifies the current password (S7, L54); a device-local
      // check would not prove anything to GoTrue.
      const payload = buildPasswordUpdatePayload(currentPw, newPw);
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
      showPwError(mapPasswordChangeErrorKey(err));
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
        avoidKeyboard
        icon="lock-reset"
      >
        <Box marginTop="s">
          <FormTextInput
            label={t('security.passwordCurrent')}
            value={currentPw}
            onChangeText={setCurrentPw}
            labelMode="static"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pwSubmitting}
            error={!!pwErrors.current}
          />
          {pwErrors.current && (
            <Text variant="caption-md" color="error" marginTop="xs">
              {pwErrors.current}
            </Text>
          )}
          <Box height={12} />
          <FormTextInput
            label={t('security.passwordNew')}
            value={newPw}
            onChangeText={setNewPw}
            labelMode="static"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pwSubmitting}
            error={!!pwErrors.new}
          />
          {pwErrors.new && (
            <Text variant="caption-md" color="error" marginTop="xs">
              {pwErrors.new}
            </Text>
          )}
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
            error={!!pwErrors.confirm}
          />
          {pwErrors.confirm && (
            <Text variant="caption-md" color="error" marginTop="xs">
              {pwErrors.confirm}
            </Text>
          )}
          {pwErrors.form && (
            <Text variant="caption-md" color="error" marginTop="s">
              {pwErrors.form}
            </Text>
          )}
        </Box>
      </ConfirmDialog>
    </>
  );
};
