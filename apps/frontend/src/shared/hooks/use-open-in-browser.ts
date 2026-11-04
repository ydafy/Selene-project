import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import Toast from 'react-native-toast-message';

/** Opens a web page in the in-app browser; shows an error toast when no browser is available. */
export const useOpenInBrowser = () => {
  const { t } = useTranslation('settings');

  return useCallback(
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
};
