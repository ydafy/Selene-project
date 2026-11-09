import React from 'react';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '@/shared/ui/base';
import { Theme } from '@/shared/theme';
import { cardStyles } from './order-card-styles';

export function UnboxingWarning() {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <Box
      {...cardStyles}
      borderColor="error"
      backgroundColor="errorSubtle"
      flexDirection="row"
      alignItems="center"
      gap="m"
      borderWidth={1}
    >
      <MaterialCommunityIcons
        name="alert-outline"
        size={24}
        color={theme.colors.primary}
      />
      <Box flex={1}>
        <Text variant="body-md" fontWeight="bold" color="primary">
          {t('orders:detail.videoWarningTitle')}
        </Text>
        <Text variant="caption-md" color="textPrimary" marginTop="xs">
          {t('orders:detail.videoWarningMsg')}
        </Text>
      </Box>
    </Box>
  );
}
