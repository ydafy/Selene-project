import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useTheme } from '@shopify/restyle';
import type { EnrichedShipment } from '@selene/types';

import { Box, Text } from '@/shared/ui/base';
import { Theme } from '@/shared/theme';

interface PrepareShipmentSelectorProps {
  shipments: EnrichedShipment[];
  selectedShipmentId: string | undefined;
  isProcessing: boolean;
  canInteract: () => boolean;
  onSelect: (shipmentId: string) => void;
}

export function PrepareShipmentSelector({
  shipments,
  selectedShipmentId,
  isProcessing,
  canInteract,
  onSelect,
}: PrepareShipmentSelectorProps) {
  const { t } = useTranslation();
  const theme = useTheme<Theme>();

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      marginTop="l"
      marginBottom="l"
      borderWidth={1}
      borderColor="separator"
    >
      {shipments.map((shipment) => (
        <TouchableOpacity
          key={shipment.id}
          disabled={isProcessing}
          accessibilityState={{ disabled: isProcessing }}
          onPress={() => {
            if (canInteract()) onSelect(shipment.id);
          }}
        >
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            paddingVertical="s"
            borderBottomWidth={1}
            borderBottomColor="separator"
          >
            <Box flex={1}>
              <Text variant="body-md">
                {shipment.items[0]?.product?.name ??
                  t('orders:card.unknownProduct')}
              </Text>
              <Text variant="caption-md" color="textSecondary">
                {t(`orders:status.${shipment.status}`)}
              </Text>
            </Box>
            <MaterialCommunityIcons
              name={
                selectedShipmentId === shipment.id
                  ? 'check-circle'
                  : 'chevron-right'
              }
              size={20}
              color={theme.colors.primary}
            />
          </Box>
        </TouchableOpacity>
      ))}
    </Box>
  );
}
