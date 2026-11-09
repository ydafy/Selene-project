import React from 'react';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '@/shared/ui/base';
import { PrimaryButton } from '@/shared/ui/button/primary-button';
import { Theme } from '@/shared/theme';

interface ConnectOnboardingNoticeProps {
  isProcessing: boolean;
  onPress: () => void;
}

export function ConnectOnboardingNotice({
  isProcessing,
  onPress,
}: ConnectOnboardingNoticeProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      marginBottom="m"
      borderWidth={1}
      borderColor="warning"
    >
      <Box flexDirection="row" alignItems="flex-start" gap="s">
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={20}
          color={theme.colors.warning}
        />
        <Box flex={1}>
          <Text variant="body-md" fontWeight="bold" marginBottom="xs">
            {t('orders:prepare.connectTitle')}
          </Text>
          <Text variant="body-sm" color="textSecondary" marginBottom="m">
            {t('orders:prepare.connectBody')}
          </Text>
          <PrimaryButton
            disabled={isProcessing}
            onPress={onPress}
            icon="bank-outline"
          >
            {t('orders:prepare.connectCta')}
          </PrimaryButton>
        </Box>
      </Box>
    </Box>
  );
}
