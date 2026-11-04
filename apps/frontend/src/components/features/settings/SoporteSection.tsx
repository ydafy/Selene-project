import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';

import { SettingsRow } from './SettingsRow';
import { resolveSupportEmail } from '../../../core/utils/supportEmail';

/**
 * Soporte section: opens the /profile/support modal, where users write to
 * the support email. Shows a localized "unavailable" toast when the email
 * is not configured.
 */
export const SoporteSection = () => {
  const { t } = useTranslation('settings');

  const email = resolveSupportEmail({
    EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  });

  const handlePress = useCallback(() => {
    if (!email) {
      Toast.show({
        type: 'info',
        text1: t('support.title'),
        text2: t('support.unavailable'),
      });
      return;
    }
    router.push('/profile/support');
  }, [email, t]);

  return (
    <SettingsRow
      icon="lifebuoy"
      label={t('support.title')}
      description={t('support.description')}
      onPress={handlePress}
    />
  );
};
