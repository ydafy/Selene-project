import React from 'react';
import { TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Box, Text } from '../../base';
import { CheckoutRow } from './CheckoutRow';
import { formatCurrency } from '../../../core/utils/format';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@shopify/restyle';
import { Theme } from '../../../core/theme';

interface SummaryBreakdownProps {
  subtotal: number;
  serviceFee: number;
  total: number;
  onHelpPress: () => void;
}

export const SummaryBreakdown = ({
  subtotal,
  serviceFee,
  total,
  onHelpPress,
}: SummaryBreakdownProps) => {
  const { t } = useTranslation('checkout');
  const theme = useTheme<Theme>();

  return (
    <Box backgroundColor="cardBackground" padding="m" borderRadius="l">
      <CheckoutRow
        label={t('summary.subtotal')}
        value={formatCurrency(subtotal)}
      />

      {/* PROTECCIÓN SELENE */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginBottom="s"
      >
        <Box flexDirection="row" alignItems="center">
          <Text variant="body-md" color="textSecondary">
            {t('summary.protection')}
          </Text>
          <TouchableOpacity
            onPress={onHelpPress}
            style={{ marginLeft: 6 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons
              name="help-circle-outline"
              size={16}
              color={theme.colors.primary}
            />
          </TouchableOpacity>
        </Box>
        <Text variant="body-md" color="textPrimary">
          {formatCurrency(serviceFee)}
        </Text>
      </Box>

      {/* ENVÍO (DISEÑO PREMIUM) */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginBottom="s"
      >
        <Text variant="body-md" color="textSecondary">
          {t('summary.shipping')}
        </Text>

        {/* BADGE TIPO PILL */}
        <Box
          backgroundColor="success"
          paddingHorizontal="m"
          paddingVertical="xs" // Padding vertical mínimo para control total
          borderRadius="xl"
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          minHeight={24} // Forzamos altura mínima para centrado consistente
        >
          <MaterialCommunityIcons
            name="check-decagram"
            size={12}
            color="white"
            style={{ marginRight: 4 }}
          />
          <Text
            variant="caption-md"
            color="textPrimary"
            style={{
              textTransform: 'uppercase',
              includeFontPadding: false, // Vital para Android: quita el espacio extra
              textAlignVertical: 'center', // Asegura centrado en Android
            }}
          >
            {t('summary.free')}
          </Text>
        </Box>
      </Box>

      <Box height={1} backgroundColor="background" marginVertical="m" />

      {/* TOTAL */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Text variant="subheader-lg" fontWeight="bold">
          {t('summary.totalToPay')}
        </Text>
        <Text variant="header-xl" color="primary" fontWeight="bold">
          {formatCurrency(total)}
        </Text>
      </Box>
    </Box>
  );
};
