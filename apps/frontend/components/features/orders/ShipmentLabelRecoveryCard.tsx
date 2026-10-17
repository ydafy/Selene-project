import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import type { Theme } from '../../../core/theme';
import type { LabelRecoveryState } from '../../../core/utils/shipment-label-state';

interface Props {
  state: LabelRecoveryState;
  isRefreshing: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onSupport: () => void;
}

export const ShipmentLabelRecoveryCard = ({
  state,
  isRefreshing,
  disabled,
  onRefresh,
  onSupport,
}: Props) => {
  const { t } = useTranslation('orders');
  const theme = useTheme<Theme>();
  const actionsDisabled = disabled || isRefreshing;

  return (
    <Box
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      borderWidth={1}
      borderColor="separator"
      marginBottom="m"
      accessibilityLiveRegion="polite"
    >
      <Box flexDirection="row" gap="s" alignItems="center" marginBottom="s">
        <MaterialCommunityIcons
          name={
            state === 'processing' ? 'clock-outline' : 'information-outline'
          }
          size={24}
          color={theme.colors.primary}
        />
        <Text variant="body-md" fontWeight="bold" flex={1}>
          {t(`prepare.recovery.${state}Title`)}
        </Text>
      </Box>
      <Text variant="body-sm" color="textSecondary" marginBottom="m">
        {t(`prepare.recovery.${state}Body`)}
      </Text>
      <Box gap="s">
        <PrimaryButton
          onPress={onRefresh}
          loading={isRefreshing}
          disabled={actionsDisabled}
        >
          {t('prepare.recovery.refresh')}
        </PrimaryButton>
        <PrimaryButton
          onPress={onSupport}
          variant="outline"
          disabled={actionsDisabled}
        >
          {t('prepare.recovery.support')}
        </PrimaryButton>
      </Box>
    </Box>
  );
};
