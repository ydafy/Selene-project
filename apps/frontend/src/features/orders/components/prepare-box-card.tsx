import React from 'react';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '@/shared/ui/base';
import type { PackagePreset } from '@/shared/hooks/use-system-config';
import { Theme } from '@/shared/theme';

interface PrepareBoxCardProps {
  productName: string | null | undefined;
  boxPreset: PackagePreset | undefined;
  isFallback: boolean;
}

export function PrepareBoxCard({
  productName,
  boxPreset,
  isFallback,
}: PrepareBoxCardProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <>
      <Text variant="subheader-lg" marginBottom="m" color="primary">
        {t('orders:prepare.boxSectionTitle')}
      </Text>
      <Box
        backgroundColor="cardBackground"
        padding="m"
        borderRadius="l"
        marginBottom="l"
        borderWidth={1}
        borderColor="separator"
      >
        <Box>
          <Text variant="caption-md" color="textSecondary">
            {t('orders:prepare.yourProduct')}
          </Text>
          <Text variant="body-md" fontWeight="bold" marginTop="xs">
            {productName ?? t('orders:card.unknownProduct')}
          </Text>
        </Box>

        {boxPreset ? (
          <Box flexDirection="row" alignItems="center" gap="s" marginTop="s">
            <MaterialCommunityIcons
              name="package-variant-closed"
              size={20}
              color={theme.colors.primary}
            />
            <Box flex={1}>
              <Text variant="body-sm" color="textPrimary">
                {boxPreset.label}
              </Text>
              <Text variant="caption-md" color="textSecondary">
                {`${boxPreset.length} × ${boxPreset.width} × ${boxPreset.height} cm · ${boxPreset.weight} kg`}
              </Text>
              {isFallback ? (
                <Text variant="caption-md" color="textSecondary" marginTop="xs">
                  {t('orders:prepare.boxFallbackNote')}
                </Text>
              ) : null}
            </Box>
          </Box>
        ) : (
          <Text variant="body-sm" color="textSecondary" marginTop="s">
            {t('orders:prepare.boxUnavailable')}
          </Text>
        )}

        <Box
          flexDirection="row"
          alignItems="flex-start"
          gap="s"
          marginTop="s"
          padding="s"
          backgroundColor="background"
          borderRadius="m"
        >
          <MaterialCommunityIcons
            name="alert-outline"
            size={16}
            color={theme.colors.warning}
          />
          <Text variant="caption-md" color="textSecondary" flex={1}>
            {t('orders:prepare.boxWarning')}
          </Text>
        </Box>
      </Box>
    </>
  );
}
