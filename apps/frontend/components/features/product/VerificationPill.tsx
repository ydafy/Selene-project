import React from 'react';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';

/** Compact badge for listings that are not verified yet. Callers position it. */
export const VerificationPill = () => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('product');

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      alignSelf="flex-start"
      backgroundColor="background"
      paddingHorizontal="s"
      paddingVertical="xs"
      borderRadius="s"
      gap="xs"
    >
      <MaterialCommunityIcons
        name="progress-clock"
        size={10}
        color={theme.colors.primary}
      />
      <Text
        variant="caption-md"
        color="primary"
        fontWeight="bold"
        style={{ fontSize: 9 }}
      >
        {t('product:visibilityBadge.verifying')}
      </Text>
    </Box>
  );
};
