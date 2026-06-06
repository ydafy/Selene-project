import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import { SettingsRow } from './SettingsRow';
import { formatVersionLabel } from '../../../core/utils/versionLabel';
import { resolveLegalUrls } from '../../../core/utils/legalUrls';

/**
 * Legales section: Terms + Privacy (tappable via expo-web-browser) and
 * a non-tappable Version row. Covers CONF-011..CONF-014.
 */
export const LegalesSection = () => {
  const { t } = useTranslation('settings');

  const urls = resolveLegalUrls({
    EXPO_PUBLIC_TERMS_URL: process.env.EXPO_PUBLIC_TERMS_URL,
    EXPO_PUBLIC_PRIVACY_URL: process.env.EXPO_PUBLIC_PRIVACY_URL,
  });

  const version = Constants.expoConfig?.version ?? undefined;
  const build =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber
      : Constants.expoConfig?.android?.versionCode;

  const versionLabel = formatVersionLabel(version, build ?? undefined);

  const openUrl = useCallback(
    async (url: string) => {
      try {
        await WebBrowser.openBrowserAsync(url);
      } catch {
        Toast.show({
          type: 'error',
          text1: t('toasts.routeErrorTitle'),
          text2: t('errors.browserNotFound'),
        });
      }
    },
    [t],
  );

  return (
    <>
      <SettingsRow
        icon="file-document-outline"
        label={t('legales.terms')}
        onPress={() => openUrl(urls.terms)}
      />
      <SettingsRow
        icon="shield-lock-outline"
        label={t('legales.privacy')}
        onPress={() => openUrl(urls.privacy)}
      />
      <SettingsRow
        icon="information-outline"
        label={t('legales.versionLabel')}
        value={versionLabel}
        showChevron={false}
      />
    </>
  );
};
