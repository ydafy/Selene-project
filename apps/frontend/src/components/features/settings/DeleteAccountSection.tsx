import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../base';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FormTextInput } from '../../ui/FormTextInput';
import { SettingsRow } from './SettingsRow';
import { useAuthContext } from '../../auth/AuthProvider';
import { resolveReauthMethod } from '../../../core/auth/reauth.logic';
import { useDeleteAccount } from '../../../core/hooks/useDeleteAccount';
import type { DeleteAccountResult } from '../../../core/hooks/deleteAccountHelpers';
import {
  DELETE_CONFIRMATION_PHRASE,
  validateDeleteConfirmation,
} from '../../../core/hooks/deleteAccountHelpers';

type DeleteAccountSectionProps = {
  disabled?: boolean;
};

type Stage = 'idle' | 'first' | 'second' | 'reauth';

export const DeleteAccountSection = ({
  disabled = false,
}: DeleteAccountSectionProps) => {
  const { t } = useTranslation('settings');
  const deleteAccount = useDeleteAccount();
  const { session } = useAuthContext();
  const reauthMethod = resolveReauthMethod(session?.user ?? null);

  const [stage, setStage] = useState<Stage>('idle');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [errorFeedback, setErrorFeedback] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const reset = () => {
    setStage('idle');
    setTypedPhrase('');
    setPassword('');
    setPasswordError(null);
  };

  const showFailure = (result: Extract<DeleteAccountResult, { ok: false }>) => {
    setErrorFeedback({
      title: t('privacy.deleteAccount'),
      message: t(result.errorKey),
    });
  };

  const handleFirstConfirm = () => {
    setStage('second');
  };

  const handleSecondConfirm = async () => {
    if (!validateDeleteConfirmation(typedPhrase)) {
      setErrorFeedback({
        title: t('privacy.secondConfirmTitle'),
        message: t('errors.phraseMismatch'),
      });
      setStage('idle'); // go back — user sees error dialog
      return;
    }

    const result = await deleteAccount.mutateAsync();

    if (result.ok) {
      // The hook already signed out locally; the success toast stays visible
      // while the app redirects.
      Toast.show({
        type: 'success',
        text1: t('toasts.deleteSuccessTitle'),
        text2: t('toasts.deleteSuccessMessage'),
      });
    } else if (result.reauthRequired) {
      // The sign-in is older than 10 minutes: ask for the identity first.
      setStage('reauth');
    } else {
      showFailure(result);
    }

    setTypedPhrase('');
  };

  const handleReauthConfirm = async () => {
    setPasswordError(null);
    const result = await deleteAccount.mutateAsync({
      reauth:
        reauthMethod === 'password'
          ? { kind: 'password', password }
          : { kind: 'google' },
    });

    if (result.ok) {
      reset();
      Toast.show({
        type: 'success',
        text1: t('toasts.deleteSuccessTitle'),
        text2: t('toasts.deleteSuccessMessage'),
      });
      return;
    }
    if (result.silent) return; // The user cancelled the Google picker.
    if (result.field === 'password') {
      setPasswordError(t(result.errorKey));
      return;
    }
    reset();
    showFailure(result);
  };

  const isPending = deleteAccount.isPending;
  const phraseValid = validateDeleteConfirmation(typedPhrase);
  const isPasswordMethod = reauthMethod === 'password';

  return (
    <>
      <SettingsRow
        icon="trash-can-outline"
        label={t('privacy.deleteAccount')}
        description={t('privacy.deleteAccountDescription')}
        onPress={() => setStage('first')}
        disabled={disabled}
        destructive
      />

      {/* First confirmation */}
      <ConfirmDialog
        visible={stage === 'first'}
        title={t('privacy.firstConfirmTitle')}
        description={t('privacy.firstConfirmMessage')}
        onCancel={reset}
        onConfirm={handleFirstConfirm}
        confirmLabel={t('privacy.firstConfirmAction')}
        isDangerous
        icon="alert-circle-outline"
      />

      {/* Second confirmation with typed phrase */}
      <ConfirmDialog
        visible={stage === 'second'}
        title={t('privacy.secondConfirmTitle')}
        description={t('privacy.secondConfirmMessage')}
        onCancel={reset}
        onConfirm={handleSecondConfirm}
        confirmLabel={t('privacy.secondConfirmAction')}
        isDangerous
        loading={isPending}
        disabled={!phraseValid}
        icon="trash-can-outline"
      >
        <Box marginTop="m">
          <FormTextInput
            value={typedPhrase}
            onChangeText={setTypedPhrase}
            placeholder={t('privacy.typedPhrasePlaceholder')}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!isPending}
            labelMode="static"
          />
          <Text variant="caption-md" color="textSecondary" marginTop="xs">
            {DELETE_CONFIRMATION_PHRASE}
          </Text>
        </Box>
      </ConfirmDialog>

      {/* Recent sign-in required by the server (S8, 10 minutes) */}
      <ConfirmDialog
        visible={stage === 'reauth'}
        title={t('privacy.reauthTitle')}
        description={
          isPasswordMethod
            ? t('privacy.reauthPasswordMessage')
            : t('privacy.reauthGoogleMessage')
        }
        onCancel={reset}
        onConfirm={handleReauthConfirm}
        confirmLabel={
          isPasswordMethod
            ? t('privacy.reauthPasswordAction')
            : t('privacy.reauthGoogleAction')
        }
        isDangerous
        loading={isPending}
        disabled={isPasswordMethod && password.length === 0}
        avoidKeyboard={isPasswordMethod}
        icon="shield-lock-outline"
      >
        {isPasswordMethod && (
          <Box marginTop="m">
            <FormTextInput
              label={t('privacy.reauthPasswordLabel')}
              value={password}
              onChangeText={setPassword}
              labelMode="static"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isPending}
              error={!!passwordError}
            />
            {passwordError && (
              <Text variant="caption-md" color="error" marginTop="xs">
                {passwordError}
              </Text>
            )}
          </Box>
        )}
      </ConfirmDialog>

      {/* Error / blocked feedback */}
      <ConfirmDialog
        visible={errorFeedback !== null}
        title={errorFeedback?.title ?? ''}
        description={errorFeedback?.message ?? ''}
        onCancel={() => setErrorFeedback(null)}
        onConfirm={() => setErrorFeedback(null)}
        hideCancel
        confirmLabel={t('common:dialog.understood', 'Aceptar')}
        isDangerous
        icon="alert-circle-outline"
      />
    </>
  );
};
