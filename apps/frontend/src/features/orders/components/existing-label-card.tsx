import React from 'react';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '@/shared/ui/base';
import { PrimaryButton } from '@/shared/ui/primary-button';
import { Theme } from '@/shared/theme';

interface ExistingLabelCardProps {
  isProcessing: boolean;
  onViewLabel: () => void;
}

export function ExistingLabelCard({
  isProcessing,
  onViewLabel,
}: ExistingLabelCardProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      marginBottom="m"
      borderWidth={1}
      borderColor="success"
    >
      <Box flexDirection="row" alignItems="center" gap="s" marginBottom="s">
        <MaterialCommunityIcons
          name="check-decagram"
          size={22}
          color={theme.colors.success}
        />
        <Text variant="body-md" fontWeight="bold">
          {t('orders:prepare.alreadyGeneratedTitle')}
        </Text>
      </Box>
      <Text variant="body-sm" color="textSecondary" marginBottom="m">
        {t('orders:prepare.alreadyGeneratedDesc')}
      </Text>
      <PrimaryButton
        disabled={isProcessing}
        onPress={onViewLabel}
        icon="printer-check"
      >
        {t('orders:actions.viewPdf')}
      </PrimaryButton>
    </Box>
  );
}
