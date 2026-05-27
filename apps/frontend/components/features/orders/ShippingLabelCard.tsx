import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';

interface Props {
  labelUrl: string;
  orderId: string;
  onShare: (url: string, id: string) => void;
  isLoading: boolean;
}

export const ShippingLabelCard = ({
  labelUrl,
  orderId,
  onShare,
  isLoading,
}: Props) => {
  const { t } = useTranslation('orders');

  return (
    <Box backgroundColor="cardBackground" padding="m" borderRadius="l">
      <Text variant="header-xl" marginBottom="l" color="primary">
        {t('prepare.shareLabelTitle')}
      </Text>
      <Box flexDirection="row" alignItems="center" marginBottom="m">
        <Box
          width={44}
          height={44}
          borderRadius="m"
          backgroundColor="primary"
          justifyContent="center"
          alignItems="center"
        >
          <MaterialCommunityIcons name="file-pdf-box" size={26} color="black" />
        </Box>

        <Box marginLeft="m" flex={1}>
          <Text variant="caption-md" color="textSecondary">
            {t('prepare.shareLabelMsg')}
          </Text>
        </Box>
      </Box>

      <PrimaryButton
        onPress={() => onShare(labelUrl, orderId)}
        loading={isLoading}
        icon="share-variant"
        style={{ flex: 1, borderRadius: 12 }}
      >
        {t('actions.shareLabel')}
      </PrimaryButton>
    </Box>
  );
};
