import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import { EnrichedShipment } from '@selene/types';

import { Box, Text } from '@/shared/ui/base';
import { PrimaryButton } from '@/shared/ui/button/primary-button';
import { Theme } from '@/shared/theme';

interface MultiSellerBannerProps {
  shipments: EnrichedShipment[];
  onViewShipment: (shipmentId: string) => void;
  onViewSummary: () => void;
}

export function MultiSellerBanner({
  shipments,
  onViewShipment,
  onViewSummary,
}: MultiSellerBannerProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      borderWidth={1}
      borderColor="primary"
      marginBottom="m"
    >
      <Box flexDirection="row" alignItems="center" gap="m" marginBottom="m">
        <MaterialCommunityIcons
          name="account-group"
          size={24}
          color={theme.colors.primary}
        />
        <Box flex={1}>
          <Text variant="body-md" fontWeight="bold" color="primary">
            {t('orders:detail.multiSellerTitle', {
              count: shipments.length,
            })}
          </Text>
        </Box>
      </Box>

      {shipments.map((shipment) => (
        <Box
          key={shipment.id}
          flexDirection="row"
          alignItems="center"
          paddingVertical="s"
          borderBottomWidth={1}
          borderBottomColor="separator"
        >
          <Box flex={1}>
            <Text variant="body-sm" color="textPrimary">
              {shipment.items.length}{' '}
              {t('orders:detail.items', {
                count: shipment.items.length,
              })}
            </Text>
            <Text variant="caption-md" color="textSecondary">
              {t(`orders:status.${shipment.status}`)}
            </Text>
          </Box>
          <TouchableOpacity onPress={() => onViewShipment(shipment.id)}>
            <Text
              variant="caption-md"
              color="primary"
              textDecorationLine="underline"
            >
              {t('orders:detail.viewShipment')}
            </Text>
          </TouchableOpacity>
        </Box>
      ))}

      <PrimaryButton
        variant="outline"
        onPress={onViewSummary}
        style={{ marginTop: 12, borderColor: theme.colors.primary }}
        icon="truck-delivery-outline"
      >
        {t('orders:detail.viewShippingSummary')}
      </PrimaryButton>
    </Box>
  );
}
