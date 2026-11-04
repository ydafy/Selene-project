import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';

import { Box, Text } from '../../../shared/ui/base';
import { PrimaryButton } from '../../../shared/ui/primary-button';
import { Theme } from '../../../shared/theme';
import { cardStyles } from './order-card-styles';

interface TrackingNumberCardProps {
  trackingNumber: string;
  isReturn: boolean;
  trackingUrl?: string;
  onCopy: (trackingNumber: string) => void;
  onTrack: (url: string) => void;
}

export function TrackingNumberCard({
  trackingNumber,
  isReturn,
  trackingUrl,
  onCopy,
  onTrack,
}: TrackingNumberCardProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <Box {...cardStyles} borderColor="primary" borderWidth={1}>
      <Text variant="header-xl" color="primary" marginBottom="m">
        {isReturn
          ? t('orders:detail.returnTrackingTitle')
          : t('orders:detail.trackingTitle')}
      </Text>
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        backgroundColor="background"
        padding="m"
        borderRadius="m"
      >
        <Box flex={1}>
          <Text variant="caption-md" color="textSecondary">
            {t('orders:detail.trackingProvider')}
          </Text>
          <Text variant="body-lg" style={{ letterSpacing: 1 }}>
            {trackingNumber}
          </Text>
        </Box>
        <TouchableOpacity onPress={() => onCopy(trackingNumber)}>
          <MaterialCommunityIcons
            name="content-copy"
            size={24}
            color={theme.colors.primary}
          />
        </TouchableOpacity>
      </Box>
      {trackingUrl ? (
        <PrimaryButton
          variant="outline"
          onPress={() => onTrack(trackingUrl)}
          style={{ marginTop: 16, borderColor: theme.colors.primary }}
          icon="truck-delivery"
        >
          {t('orders:actions.trackOrder')}
        </PrimaryButton>
      ) : null}
    </Box>
  );
}
