import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { SettingsRow } from './SettingsRow';

type GeneralSectionProps = {
  onRouteError?: () => void;
};

export const GeneralSection = ({ onRouteError }: GeneralSectionProps) => {
  const { t } = useTranslation('settings');
  const router = useRouter();

  const safePush = (path: string) => {
    try {
      router.push(path as never);
    } catch {
      onRouteError?.();
    }
  };

  return (
    <>
      <SettingsRow
        icon="map-marker-outline"
        label={t('general.addresses')}
        description={t('general.addressesDescription')}
        onPress={() => safePush('/address/form')}
      />
      <SettingsRow
        icon="bell-outline"
        label={t('general.notifications')}
        description={t('general.notificationsDescription')}
        onPress={() => safePush('/profile/notifications')}
      />
    </>
  );
};
