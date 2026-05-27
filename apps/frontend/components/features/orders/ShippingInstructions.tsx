import React, { ComponentProps } from 'react';
import { Linking } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Theme } from '../../../core/theme';

// Tipado estricto para los iconos de MaterialCommunityIcons
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface Props {
  labelUrl?: string;
  orderId?: string;
  carrierName?: string;
  isSharing?: boolean;
}

export const ShippingInstructions = ({ carrierName = 'Estafeta' }: Props) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('orders');

  const handleFindBranch = () => {
    // Búsqueda dinámica en Google Maps según el carrier
    const query = encodeURIComponent(`${carrierName} cerca de mi`);
    const url = `https://www.google.com/maps/search/?api=1&query=${query}`;
    Linking.openURL(url).catch((err) =>
      console.error('Error opening maps', err),
    );
  };

  // Sub-componente interno para los pasos (Limpio y tipado)
  const Step = ({
    icon,
    text,
    number,
  }: {
    icon: IconName;
    text: string;
    number: string;
  }) => (
    <Box flexDirection="row" alignItems="center" marginBottom="m">
      <Box
        width={28}
        height={28}
        borderRadius="full"
        backgroundColor="primary"
        justifyContent="center"
        alignItems="center"
      >
        <Text variant="caption-md" color="background" fontWeight="bold">
          {number}
        </Text>
      </Box>
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={theme.colors.primary}
        style={{ marginHorizontal: 12 }}
      />
      <Text variant="body-sm" flex={1} color="textPrimary">
        {text}
      </Text>
    </Box>
  );

  return (
    <Box backgroundColor="cardBackground" padding="m" borderRadius="l">
      <Text variant="header-xl" marginBottom="l" color="primary">
        {t('prepare.instructionsTitle')}
      </Text>

      <Step number="1" icon="printer-pos" text={t('prepare.step1')} />
      <Step
        number="2"
        icon="package-variant-closed"
        text={t('prepare.step2')}
      />
      <Step number="3" icon="map-marker-radius" text={t('prepare.step3')} />

      <Box flexDirection="row" gap="s" marginTop="s">
        <PrimaryButton
          variant="outline"
          onPress={handleFindBranch}
          style={{
            flex: 1,
            justifyContent: 'space-evenly',
            borderColor: theme.colors.primary,
          }}
          labelStyle={{ fontSize: 12 }}
          icon="google-maps"
        >
          {t('actions.findBranch')}
        </PrimaryButton>
      </Box>
    </Box>
  );
};
