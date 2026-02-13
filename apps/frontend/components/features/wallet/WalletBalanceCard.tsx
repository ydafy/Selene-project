import React from 'react';
import { useTheme } from '@shopify/restyle';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { TouchableOpacity } from 'react-native';

import { Box, Text } from '../../base';
import { Skeleton } from '../../ui/Skeleton';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Theme } from '../../../core/theme';
import { formatCurrency } from '../../../core/utils/format';

interface Props {
  available: number;
  pending: number;
  isLoading: boolean;
  onWithdraw: () => void;
  isBankConfigured: boolean;
  onConfigureBank: () => void;
}

export const WalletBalanceCard = ({
  available,
  pending,
  isLoading,
  onWithdraw,
  isBankConfigured,
  onConfigureBank,
}: Props) => {
  const { t } = useTranslation('wallet');
  const theme = useTheme<Theme>();

  if (isLoading) {
    return (
      <Skeleton width="100%" height={180} borderRadius={theme.borderRadii.l} />
    );
  }

  return (
    <Box
      backgroundColor="cardBackground"
      padding="l"
      borderRadius="l"
      borderWidth={1}
      borderColor="separator"
      style={{
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      }}
    >
      <Box flexDirection="row" alignItems="center" marginBottom="s">
        <MaterialCommunityIcons
          name="wallet-outline"
          size={20}
          color={theme.colors.primary}
        />
        <Text
          variant="caption-lg"
          marginLeft="s"
          marginRight="s"
          color="textSecondary"
        >
          {t('balance.availableTitle')}
        </Text>

        {/* INDICADOR DE BANCO */}
        <TouchableOpacity onPress={onConfigureBank}>
          <Box
            flexDirection="row"
            alignItems="center"
            backgroundColor="background"
            paddingHorizontal="s"
            paddingVertical="xs"
            borderRadius="s"
          >
            <MaterialCommunityIcons
              name={
                isBankConfigured ? 'check-decagram' : 'alert-circle-outline'
              }
              size={14}
              color={
                isBankConfigured ? theme.colors.success : theme.colors.primary
              }
            />
            <Text
              variant="body-sm"
              marginLeft="xs"
              color={isBankConfigured ? 'success' : 'primary'}
            >
              {isBankConfigured
                ? t('bankConfiguration.configured')
                : t('bankConfiguration.notConfigured')}
            </Text>
          </Box>
        </TouchableOpacity>
      </Box>

      <Text variant="header-2xl" color="primary" marginBottom="m">
        {formatCurrency(available)}
      </Text>

      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingTop="m"
        borderTopWidth={1}
        borderTopColor="separator"
      >
        <Box>
          <Text variant="caption-md" color="textSecondary">
            {t('balance.pendingTitle')}
          </Text>
          <Text variant="subheader-md" color="textPrimary">
            {formatCurrency(pending)}
          </Text>
        </Box>

        <PrimaryButton
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onWithdraw();
          }}
          disabled={available <= 0}
          style={{ paddingHorizontal: 20, height: 40 }}
        >
          {t('actions.withdraw')}
        </PrimaryButton>
      </Box>
    </Box>
  );
};
