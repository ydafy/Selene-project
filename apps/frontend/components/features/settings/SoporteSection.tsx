import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';

import { SettingsRow } from './SettingsRow';
import { resolveChatwootConfig } from '../../../core/utils/chatwoot';

/**
 * Soporte section: opens the dedicated /profile/support modal where the
 * Chatwoot widget mounts. Falls back to a localized "unavailable" toast
 * if env config is missing. Covers CONF-018.
 */
export const SoporteSection = () => {
  const { t } = useTranslation('settings');

  const config = resolveChatwootConfig({
    EXPO_PUBLIC_CHATWOOT_BASE_URL: process.env.EXPO_PUBLIC_CHATWOOT_BASE_URL,
    EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN:
      process.env.EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN,
  });

  const handlePress = useCallback(() => {
    if (!config.available) {
      Toast.show({
        type: 'info',
        text1: t('support.title'),
        text2: t('support.unavailable'),
      });
      return;
    }
    router.push('/profile/support');
  }, [config.available, t]);

  return (
    <SettingsRow
      icon="lifebuoy"
      label={t('support.title')}
      description={t('support.description')}
      onPress={handlePress}
    />
  );
};
