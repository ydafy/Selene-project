import React from 'react';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { useTranslation } from 'react-i18next';

/**
 * Componente que muestra el texto de envío para los productos en el checkout.
 * - "free": Envío Gratis con Estafeta
 * - "protected": Envío Estafeta Protegido
 */
export const ShippingInfo = ({ type }: { type: 'free' | 'protected' }) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('checkout');

  const isFree = type === 'free';

  return (
    <Box
      marginTop="s"
      padding="m"
      backgroundColor="cardBackground" // Fondo neutro para consistencia
      borderRadius="m"
      borderWidth={1}
      borderColor={isFree ? 'success' : 'cardBackground'}
      flexDirection="row"
      alignItems="center"
    >
      <Box
        backgroundColor={isFree ? 'success' : 'cardBackground'}
        padding="s"
        borderRadius="s"
      >
        <MaterialCommunityIcons
          name={isFree ? 'truck-check' : 'shield-check'}
          size={25}
          color={theme.colors.primary}
        />
      </Box>
      <Box marginLeft="m" flex={1}>
        <Text
          variant="body-sm"
          fontWeight="bold"
          color={isFree ? 'success' : 'textPrimary'}
        >
          {isFree
            ? t('shipping.freeWithEstafeta')
            : t('shipping.estafetaProtected')}
        </Text>
        <Text variant="caption-md" color="textSecondary">
          {t('shipping.includesInsurance')}
        </Text>
      </Box>
      {isFree && (
        <Box backgroundColor="success" paddingHorizontal="s" borderRadius="s">
          <Text variant="caption-md" color="textPrimary" fontWeight="bold">
            GRATIS
          </Text>
        </Box>
      )}
    </Box>
  );
};
