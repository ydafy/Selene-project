import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { PRIVACY_URL, TERMS_URL } from '@selene/types';

import { SettingsRow } from './SettingsRow';
import { formatVersionLabel } from '../../../core/utils/versionLabel';
import { useOpenInBrowser } from '../../../core/hooks/useOpenInBrowser';

/**
 * Legales section: Terms + Privacy (tappable via expo-web-browser) and
 * a non-tappable Version row. Covers CONF-011..CONF-014.
 */
export const LegalesSection = () => {
  const { t } = useTranslation('settings');
  const openUrl = useOpenInBrowser();

  const version = Constants.expoConfig?.version ?? undefined;
  const build =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber
      : Constants.expoConfig?.android?.versionCode;

  const versionLabel = formatVersionLabel(version, build ?? undefined);

  return (
    <>
      <SettingsRow
        icon="file-document-outline"
        label={t('legales.terms')}
        onPress={() => openUrl(TERMS_URL)}
      />
      <SettingsRow
        icon="shield-lock-outline"
        label={t('legales.privacy')}
        onPress={() => openUrl(PRIVACY_URL)}
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
