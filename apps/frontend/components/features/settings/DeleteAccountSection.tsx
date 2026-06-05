import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FormTextInput } from '../../ui/FormTextInput';
import { SettingsRow } from './SettingsRow';
import { useDeleteAccount } from '../../../core/hooks/useDeleteAccount';
import {
  DELETE_CONFIRMATION_PHRASE,
  validateDeleteConfirmation,
  stripSettingsNamespace,
} from '../../../core/hooks/deleteAccountHelpers';

type DeleteAccountSectionProps = {
  disabled?: boolean;
};

type Stage = 'idle' | 'first' | 'second';

export const DeleteAccountSection = ({
  disabled = false,
}: DeleteAccountSectionProps) => {
  const { t } = useTranslation('settings');
  const deleteAccount = useDeleteAccount();

  const [stage, setStage] = useState<Stage>('idle');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [errorFeedback, setErrorFeedback] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const reset = () => {
    setStage('idle');
    setTypedPhrase('');
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

    if (!result.ok) {
      // On failure (blocked reason, network error) show error.
      // On success, the hook's onSuccess handles signOut + redirect — no dialog needed.
      const key = stripSettingsNamespace(result.errorKey);
      setErrorFeedback({
        title: t('privacy.deleteAccount'),
        message: t(key),
      });
    }

    setTypedPhrase('');
  };

  const isPending = deleteAccount.isPending;
  const phraseValid = validateDeleteConfirmation(typedPhrase);

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
