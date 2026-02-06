import React from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { PaymentMethod } from '@selene/types';
import { BrandIcon } from '../../ui/BrandIcon'; // Ajustar ruta según tu estructura

interface PaymentMethodRowProps {
  method?: PaymentMethod | null;
  onPress: () => void;
  error?: boolean;
}

export const PaymentMethodRow = ({
  method,
  onPress,
  error,
}: PaymentMethodRowProps) => {
  const theme = useTheme<Theme>();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Box
        backgroundColor="cardBackground"
        padding="m"
        borderRadius="m"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        borderWidth={1}
        borderColor={error ? 'error' : 'transparent'}
      >
        <Box flex={1} flexDirection="row" alignItems="center">
          {/* Lógica de Icono: SVG de Marca o Icono de Agregar */}
          <Box
            width={44}
            height={30}
            justifyContent="center"
            alignItems="center"
            backgroundColor="background"
            borderRadius="s"
            overflow="visible"
          >
            {method ? (
              <BrandIcon name={method.brand.toLowerCase()} size={24} />
            ) : (
              <MaterialCommunityIcons
                name="credit-card-plus-outline"
                size={24}
                color={theme.colors.primary}
              />
            )}
          </Box>

          <Box marginLeft="m" flex={1}>
            {method ? (
              <>
                <Text variant="body-md" fontWeight="bold" color="textPrimary">
                  {method.brand.toUpperCase()} •••• {method.last4}
                </Text>
                <Text variant="caption-md" color="textSecondary">
                  Expira {method.exp_month.toString().padStart(2, '0')}/
                  {method.exp_year}
                </Text>
              </>
            ) : (
              <Text variant="body-md" color="textSecondary">
                Seleccionar método de pago
              </Text>
            )}
          </Box>
        </Box>

        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={theme.colors.textSecondary}
        />
      </Box>
    </TouchableOpacity>
  );
};
