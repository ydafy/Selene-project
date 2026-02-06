import React from 'react';
import { TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { ShippingOption, ShippingCarrier } from '@selene/types';
import { formatCurrency } from '../../../core/utils/format';

type Props = {
  options: ShippingOption[]; // Las opciones que YA tienen precio
  selectedOption?: ShippingOption;
  onSelect: (option: { carrier: ShippingCarrier; price?: number }) => void;
  isLoading?: boolean;
};

const AVAILABLE_CARRIERS: ShippingCarrier[] = [
  'dhl',
  'estafeta',
  'paquetexpress',
];

export const ShippingMethodSelector = ({
  options,
  selectedOption,
  onSelect,
  isLoading,
}: Props) => {
  const theme = useTheme<Theme>();

  return (
    <Box gap="s" marginTop="s">
      {AVAILABLE_CARRIERS.map((carrierName) => {
        // Buscamos si ya tenemos precio para este carrier
        const quotedOption = options.find(
          (o) => o.carrier.toLowerCase() === carrierName.toLowerCase(),
        );

        const isSelected =
          selectedOption?.carrier.toLowerCase() === carrierName.toLowerCase();
        const hasPrice = !!quotedOption;

        // Si está seleccionado pero no tiene precio, es que está cargando
        const isLoadingThis = isSelected && isLoading && !hasPrice;

        return (
          <TouchableOpacity
            key={carrierName}
            onPress={() => onSelect(quotedOption || { carrier: carrierName })}
            activeOpacity={0.8}
            disabled={isLoadingThis}
          >
            <Box
              flexDirection="row"
              alignItems="center"
              padding="m"
              borderRadius="m"
              backgroundColor="cardBackground"
              borderWidth={1}
              borderColor={isSelected ? 'primary' : 'cardBackground'}
              opacity={isLoadingThis ? 0.6 : 1}
            >
              <MaterialCommunityIcons
                name={isSelected ? 'radiobox-marked' : 'radiobox-blank'}
                size={20}
                color={
                  isSelected ? theme.colors.primary : theme.colors.textSecondary
                }
              />

              <Box flex={1} marginLeft="m">
                <Box flexDirection="row" alignItems="center">
                  <Text
                    variant="body-md"
                    fontWeight="bold"
                    style={{ textTransform: 'capitalize' }}
                  >
                    {carrierName}
                  </Text>
                  {/* Badge de Recomendado para DHL */}
                  {carrierName === 'dhl' && (
                    <Box
                      backgroundColor="primary"
                      paddingHorizontal="xs"
                      borderRadius="s"
                      marginLeft="s"
                    >
                      <Text
                        variant="caption-md"
                        color="background"
                        fontWeight="bold"
                      >
                        RÁPIDO
                      </Text>
                    </Box>
                  )}
                  {/* Badge de Económico para Estafeta */}
                  {carrierName === 'estafeta' && (
                    <Box
                      backgroundColor="success"
                      paddingHorizontal="xs"
                      borderRadius="s"
                      marginLeft="s"
                    >
                      <Text
                        variant="caption-md"
                        color="background"
                        fontWeight="bold"
                      >
                        ECONÓMICO
                      </Text>
                    </Box>
                  )}
                </Box>

                {hasPrice && (
                  <Text variant="caption-md" color="textSecondary">
                    {quotedOption.service || 'Estándar'}
                  </Text>
                )}
              </Box>

              {/* PRECIO O SPINNER */}
              {isLoadingThis ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : hasPrice ? (
                <Text variant="body-md" fontWeight="bold" color="textPrimary">
                  {formatCurrency(quotedOption.price)}
                </Text>
              ) : (
                <Text variant="caption-md" color="primary" fontWeight="bold">
                  Cotizar
                </Text>
              )}
            </Box>
          </TouchableOpacity>
        );
      })}
    </Box>
  );
};
