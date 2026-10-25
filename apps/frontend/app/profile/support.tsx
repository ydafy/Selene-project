/**
 * @file app/profile/support.tsx
 * @description /profile/support modal: users write to the support email for
 * questions and reports. The address stays visible so it can be copied when
 * the device has no mail app.
 */
import { useCallback } from 'react';
import { Linking, TouchableOpacity } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

import { Box, Text } from '../../components/base';
import { ScreenLayout } from '../../components/layout/ScreenLayout';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { Theme } from '../../core/theme';
import {
  buildSupportMailto,
  resolveSupportEmail,
} from '../../core/utils/supportEmail';

export default function SupportScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme<Theme>();

  const email = resolveSupportEmail({
    EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  });

  const openMail = useCallback(async () => {
    if (!email) {
      Toast.show({
        type: 'info',
        text1: t('support.title'),
        text2: t('support.unavailable'),
      });
      return;
    }
    try {
      await Linking.openURL(buildSupportMailto(email, t('support.emailSubject')));
    } catch {
      Toast.show({
        type: 'info',
        text1: t('support.title'),
        text2: t('support.noMailApp', { email }),
      });
    }
  }, [email, t]);

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
          name="email-outline"
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

        {email ? (
          <Text
            variant="subheader-md"
            color="primary"
            marginTop="s"
            textAlign="center"
            selectable
          >
            {email}
          </Text>
        ) : (
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
          <PrimaryButton onPress={openMail} disabled={!email}>
            {t('support.cta')}
          </PrimaryButton>
        </Box>
      </Box>
    </ScreenLayout>
  );
}
