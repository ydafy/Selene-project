import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../base';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FormTextInput } from '../../ui/FormTextInput';
import { SettingsRow } from './SettingsRow';
import { supabase } from '../../../core/db/supabase';
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

  // Logout dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Password change dialog (CONF-017 / EXTD-TASK-009)
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const resetPwForm = () => {
    setCurrentPw('');
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
    const validation = validatePasswordChange(currentPw, newPw, confirmPw);
    if (!validation.ok) {
      setPwError(t(validation.errorKey));
      return;
    }
    setPwError(null);
    setPwSubmitting(true);
    try {
      const nonce = generatePasswordNonce();
      const payload = buildPasswordUpdatePayload(newPw, nonce);
      // NOTE: `currentPassword` is supported from @supabase/supabase-js ^2.102.0.
      // Installed version is ^2.81.1 — when upgraded, pass `currentPassword: currentPw`.
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
      // Heuristic: Supabase returns "Invalid login credentials" / "wrong" for
      // password reauth failures. Map anything else to a generic error.
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
        onPress={() => setPwOpen(true)}
        disabled={disabled}
      />

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
            label={t('security.passwordCurrent')}
            value={currentPw}
            onChangeText={setCurrentPw}
            labelMode="static"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pwSubmitting}
          />
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
