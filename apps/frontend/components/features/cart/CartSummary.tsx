import { useTheme } from '@shopify/restyle';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../base';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Theme } from '../../../core/theme';
import { formatCurrency } from '../../../core/utils/format';
import { getTabDockMetrics } from '../../../core/constants/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type CartSummaryProps = {
  total: number;
  onCheckout: () => void;
  itemCount: number;
  disabled?: boolean;
};

export const CartSummary = ({
  total,
  onCheckout,
  itemCount,
  disabled = false,
}: CartSummaryProps) => {
  const insets = useSafeAreaInsets();
  const theme = useTheme<Theme>();
  const { t } = useTranslation('cart');

  if (itemCount === 0) return null;

  return (
    <Box
      position="absolute"
      bottom={getTabDockMetrics(insets.bottom).contentBottomClearance}
      left={theme.spacing.m}
      right={theme.spacing.m}
      backgroundColor="cardBackground"
      padding="m"
      borderRadius="l"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4.65,
        elevation: 8,
      }}
    >
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginBottom="m"
      >
        <Box>
          <Text variant="caption-md" color="textSecondary">
            {t('total')} ({itemCount} items)
          </Text>
          <Text
            variant="header-xl"
            color={disabled ? 'textSecondary' : 'primary'}
            style={{ fontFamily: 'Montserrat-Bold' }}
          >
            {formatCurrency(total)}
          </Text>
        </Box>
      </Box>

      {/* 2. CONECTAR EL DISABLED AL BOTÓN */}
      <PrimaryButton
        onPress={onCheckout}
        icon="credit-card-outline"
        disabled={disabled}
      >
        {t('checkout')}
      </PrimaryButton>
    </Box>
  );
};
