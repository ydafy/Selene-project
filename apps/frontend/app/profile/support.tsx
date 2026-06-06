/**
 * @file app/profile/support.tsx
 * @description /profile/support modal — Chatwoot widget host with web
 * fallback via expo-web-browser. Covers CONF-018 (EXTD-TASK-010).
 *
 * The native @chatwoot/react-native-widget package is loaded dynamically
 * so the route can render even when the dependency is not yet installed
 * (placeholder phase). If the require fails OR the runtime widget throws,
 * the screen renders the fallback button that opens the chat URL via
 * expo-web-browser.
 */
import { useCallback, useEffect, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../components/base';
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { Theme } from '../../core/theme';
import {
  resolveChatwootConfig,
  buildChatwootChatUrl,
} from '../../core/utils/chatwoot';

export default function SupportScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme<Theme>();

  const config = resolveChatwootConfig({
    EXPO_PUBLIC_CHATWOOT_BASE_URL: process.env.EXPO_PUBLIC_CHATWOOT_BASE_URL,
    EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN:
      process.env.EXPO_PUBLIC_CHATWOOT_WEBSITE_TOKEN,
  });
  const chatUrl = buildChatwootChatUrl(config);

  const [widgetUnavailable, setWidgetUnavailable] = useState(false);

  useEffect(() => {
    // Attempt to load the native widget dynamically. If the dependency is
    // not yet installed (placeholder phase) or fails to evaluate, mark the
    // widget as unavailable so the fallback CTA is the only path.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@chatwoot/react-native-widget');
    } catch {
      setWidgetUnavailable(true);
    }
  }, []);

  const openWebFallback = useCallback(async () => {
    if (!chatUrl) {
      Toast.show({
        type: 'info',
        text1: t('support.title'),
        text2: t('support.unavailable'),
      });
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(chatUrl);
    } catch {
      Toast.show({
        type: 'error',
        text1: t('toasts.routeErrorTitle'),
        text2: t('errors.browserNotFound'),
      });
    }
  }, [chatUrl, t]);

  return (
    <ScreenLayout>
      <Stack.Screen
        options={{ headerShown: false, presentation: 'modal' }}
      />

      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="m"
        paddingVertical="m"
      >
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="close"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialCommunityIcons
            name="close"
            size={24}
            color={theme.colors.textPrimary}
          />
        </TouchableOpacity>
        <Text variant="subheader-md" color="textPrimary">
          {t('support.title')}
        </Text>
        <Box width={24} />
      </Box>

      <Box flex={1} padding="l" justifyContent="center" alignItems="center">
        <MaterialCommunityIcons
          name="lifebuoy"
          size={64}
          color={theme.colors.primary}
        />
        <Text
          variant="body-md"
          color="textPrimary"
          marginTop="m"
          textAlign="center"
        >
          {t('support.description')}
        </Text>

        {widgetUnavailable && (
          <Text
            variant="caption-md"
            color="textSecondary"
            marginTop="s"
            textAlign="center"
          >
            {t('support.unavailable')}
          </Text>
        )}

        <Box marginTop="xl" width="100%">
          <PrimaryButton onPress={openWebFallback} disabled={!chatUrl}>
            {t('support.title')}
          </PrimaryButton>
        </Box>
      </Box>
    </ScreenLayout>
  );
}
