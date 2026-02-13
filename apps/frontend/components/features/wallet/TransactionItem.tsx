import React, { ComponentProps } from 'react';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Box, Text } from '../../base';
import { Theme } from '../../../core/theme';
import { WalletTransaction } from '../../../../../packages/types/src/index';
import { formatCurrency } from '../../../core/utils/format';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface Props {
  transaction: WalletTransaction;
}

export const TransactionItem = ({ transaction }: Props) => {
  const { t } = useTranslation('wallet');
  const theme = useTheme<Theme>();
  const isPositive = ['sale_proceeds', 'release', 'adjustment'].includes(
    transaction.type,
  );

  const getIconConfig = (): { name: IconName; color: string } => {
    switch (transaction.type) {
      case 'sale_proceeds':
        return { name: 'tag-plus-outline', color: theme.colors.success };
      case 'payout':
        return { name: 'bank-transfer-out', color: theme.colors.error };
      case 'release':
        return { name: 'lock-open-outline', color: theme.colors.success };
      default:
        return { name: 'swap-vertical', color: theme.colors.textSecondary };
    }
  };

  const icon = getIconConfig();

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      paddingVertical="m"
      borderBottomWidth={1}
      borderBottomColor="separator"
    >
      <Box
        width={44}
        height={44}
        borderRadius="m"
        backgroundColor="cardBackground"
        justifyContent="center"
        alignItems="center"
      >
        <MaterialCommunityIcons name={icon.name} size={22} color={icon.color} />
      </Box>
      <Box flex={1} marginLeft="m">
        <Text variant="body-md" fontWeight="600">
          {t(`types.${transaction.type}`)}
        </Text>
        <Text variant="caption-md" color="textSecondary">
          {new Date(transaction.created_at).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </Text>
      </Box>
      <Box alignItems="flex-end">
        <Text
          variant="body-lg"
          color={isPositive ? 'success' : 'textPrimary'}
          fontWeight="700"
        >
          {isPositive ? '+' : ''}
          {formatCurrency(transaction.net_amount)}
        </Text>
        <Text variant="caption-md" color="textSecondary">
          {t('history.balanceAfter')}:{' '}
          {formatCurrency(transaction.balance_after)}
        </Text>
      </Box>
    </Box>
  );
};
