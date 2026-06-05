import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { SettingsRow } from './SettingsRow';
import { supabase } from '../../../core/db/supabase';

type SecuritySectionProps = {
  disabled?: boolean;
};

export const SecuritySection = ({ disabled = false }: SecuritySectionProps) => {
  const { t } = useTranslation('settings');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setLoading(false);
      setDialogOpen(false);
    }
  };

  return (
    <>
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
    </>
  );
};
