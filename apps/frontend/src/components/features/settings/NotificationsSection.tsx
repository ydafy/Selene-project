import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SettingsRow } from './SettingsRow';
import { useAuthContext } from '../../../shared/lib/auth/auth-provider';
import { pushRegistrar } from '../../../core/push/pushRegistration';
import {
  getPushPermission,
  pushPermissionPrompt,
} from '../../../core/push/pushPermission';
import {
  pushSettingsRow,
  type PushPermission,
} from '../../../core/push/pushPermission.logic';

/** Push row that reflects the OS permission, read again on every foreground. */
export const NotificationsSection = () => {
  const { t } = useTranslation('settings');
  const { session } = useAuthContext();
  const userId = session?.user.id;
  const [permission, setPermission] = useState<PushPermission | null>(null);

  const refresh = useCallback(() => {
    getPushPermission()
      .then(setPermission)
      .catch((error) => {
        console.warn('[NotificationsSection] Permission read failed:', error);
      });
  }, []);

  useEffect(() => {
    refresh();
    // Back from the OS settings, the permission may have changed.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => appState.remove();
  }, [refresh]);

  if (Platform.OS === 'web' || !permission) return null;

  const row = pushSettingsRow(permission);
  const onPress = () => {
    if (row.action === 'openSettings') {
      void Linking.openSettings();
      return;
    }
    void pushPermissionPrompt.request().then((granted) => {
      if (granted && userId) void pushRegistrar.register(userId);
      refresh();
    });
  };

  return (
    <SettingsRow
      icon="bell-outline"
      label={t('pushNotifications.label')}
      description={t(`pushNotifications.${row.description}`)}
      value={t(`pushNotifications.${row.value}`)}
      onPress={onPress}
    />
  );
};
