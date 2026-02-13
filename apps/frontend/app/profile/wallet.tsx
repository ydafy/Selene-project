import React from 'react';
import { ScrollView, RefreshControl } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Box, Text } from '../../components/base';

import { WalletBalanceCard } from '../../components/features/wallet/WalletBalanceCard';
import { TransactionItem } from '../../components/features/wallet/TransactionItem';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState'; // Asumiendo que existe
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useWalletScreen } from '../../core/hooks/useWalletScreen';
import { theme } from '@/core/theme';
import { GlobalHeader } from '@/components/layout/GlobalHeader';
import {
  BankConfigurationSheet,
  BankSheetRef,
} from '../../components/features/wallet/BankConfigurationSheet';

export default function WalletScreen() {
  const { t } = useTranslation(['wallet', 'common']);
  const { session } = useAuthContext();

  const bankSheetRef = React.useRef<BankSheetRef>(null);

  const { wallet, transactions, isLoading, bankAccount, error, loadData } =
    useWalletScreen(session?.user.id);

  const handleWithdrawPress = () => {
    if (!bankAccount) {
      bankSheetRef.current?.present();
    } else {
      router.push('/profile/withdraw');
    }
  };
  if (error) {
    return (
      <Box flex={1} backgroundColor="background">
        <Stack.Screen options={{ headerShown: false }} />
        <GlobalHeader title={t('screenTitle')} showBack />
        <ErrorState
          title={t('common:errors.title')}
          message={error}
          onRetry={loadData}
        />
        ;
      </Box>
    );
  }

  return (
    <Box flex={1} backgroundColor="background">
      <Stack.Screen options={{ headerShown: false }} />
      <GlobalHeader title={t('screenTitle')} showBack />

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingTop: 150,
          paddingBottom: 40,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={loadData}
            tintColor={theme.colors.primary}
          />
        }
      >
        <WalletBalanceCard
          available={wallet?.available_balance || 0}
          pending={wallet?.pending_balance || 0}
          isLoading={isLoading && !wallet}
          onWithdraw={handleWithdrawPress}
          isBankConfigured={!!bankAccount}
          onConfigureBank={() => bankSheetRef.current?.present()}
        />

        <Box marginTop="xl">
          <Text variant="subheader-lg" marginBottom="m">
            {t('history.title')}
          </Text>

          {transactions.length === 0 && !isLoading ? (
            <EmptyState
              icon="history"
              title={t('history.emptyTitle')}
              message={t('history.emptyMessage')}
            />
          ) : (
            transactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))
          )}
        </Box>
      </ScrollView>

      {/* Modal de Configuración */}
      <BankConfigurationSheet ref={bankSheetRef} />
    </Box>
  );
}
