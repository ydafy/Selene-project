import React from 'react';
import { TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { PaymentMethod } from '@selene/types';
import { BrandIcon } from '../../ui/BrandIcon';

interface PaymentMethodRowProps {
  method?: PaymentMethod | null;
  onPress: () => void;
  error?: boolean;
  isLoading?: boolean; // Prop añadida para feedback visual
}

export const PaymentMethodRow = ({
  method,
  onPress,
  error,
  isLoading,
}: PaymentMethodRowProps) => {
  const theme = useTheme<Theme>();
  const { t } = useTranslation('checkout');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      disabled={isLoading}
      // ACCESIBILIDAD
      accessibilityLabel={
        method
          ? `${method.brand} ${t('payment.endingIn')} ${method.last4}`
          : t('payment.selectMethod')
      }
      accessibilityRole="button"
      accessibilityState={{ disabled: isLoading }}
    >
      <Box
        backgroundColor="cardBackground"
        padding="m"
        borderRadius="m"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        borderWidth={error ? 2 : 1}
        borderColor={error ? 'error' : 'separator'}
      >
        {isLoading ? (
          <Box flex={1} height={40} justifyContent="center">
            <ActivityIndicator size="small" color={theme.colors.primary} />
          </Box>
        ) : (
          <>
            <Box flex={1} flexDirection="row" alignItems="center">
              <Box
                width={44}
                height={30}
                justifyContent="center"
                alignItems="center"
                backgroundColor="background"
                borderRadius="s"
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
                    <Text
                      variant="body-md"
                      fontWeight="bold"
                      color="textPrimary"
                    >
                      {method.brand.toUpperCase()} •••• {method.last4}
                    </Text>
                    <Text variant="caption-md" color="textSecondary">
                      {t('payment.expires', {
                        month: method.exp_month.toString().padStart(2, '0'),
                        year: method.exp_year,
                      })}
                    </Text>
                  </>
                ) : (
                  <Text variant="body-md" color="textSecondary">
                    {t('payment.selectMethod')}
                  </Text>
                )}
              </Box>
            </Box>
            <MaterialCommunityIcons
              name="chevron-right"
              size={24}
              color={theme.colors.textSecondary}
            />
          </>
        )}
      </Box>
    </TouchableOpacity>
  );
};
