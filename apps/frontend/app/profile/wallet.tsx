import React, { useRef, useState } from 'react';
import { RefreshControl } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlashList } from '@shopify/flash-list';

import { Box, Text } from '../../components/base';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WalletBalanceCard } from '../../components/features/wallet/WalletBalanceCard';
import { TransactionItem } from '../../components/features/wallet/TransactionItem';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { useAuthContext } from '../../components/auth/AuthProvider';
import { useWalletScreen } from '../../core/hooks/useWalletScreen';
import { theme } from '@/core/theme';
import { GlobalHeader } from '@/components/layout/GlobalHeader';
import {
  BankConfigurationSheet,
  BankSheetRef,
} from '../../components/features/wallet/BankConfigurationSheet';

import {
  TransactionDetailSheet,
  TransactionDetailRef,
} from '../../components/features/wallet/TransactionDetailSheet';

import { WalletTransaction } from '../../../../packages/types/src/index';

export default function WalletScreen() {
  const { t } = useTranslation(['wallet', 'common']);
  const { session } = useAuthContext();
  const insets = useSafeAreaInsets();

  const bankSheetRef = React.useRef<BankSheetRef>(null);
  const detailSheetRef = useRef<TransactionDetailRef>(null);
  const [selectedTx, setSelectedTx] = useState<WalletTransaction | null>(null);

  const { wallet, transactions, isLoading, bankAccount, error, loadData } =
    useWalletScreen(session?.user.id);

  const handleTransactionPress = (tx: WalletTransaction) => {
    setSelectedTx(tx);
    // Pequeño delay para asegurar que el estado se actualizó antes de abrir

    detailSheetRef.current?.present();
  };

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
          title={t('errors.title')}
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

      <FlashList
        data={transactions}
        keyExtractor={(item) => item.id}
        // Siguiendo tu patrón de contentContainerStyle
        contentContainerStyle={{
          paddingTop: insets.top + 110, // Un poco más de espacio para el GlobalHeader
          paddingBottom: 100,
          paddingHorizontal: 16,
        }}
        ListHeaderComponent={
          <Box marginBottom="m">
            <WalletBalanceCard
              available={wallet?.available_balance || 0}
              pending={wallet?.pending_balance || 0}
              isLoading={isLoading && !wallet}
              onWithdraw={handleWithdrawPress}
              isBankConfigured={!!bankAccount}
              onConfigureBank={() => bankSheetRef.current?.present()}
            />
            <Box marginTop="xl" marginBottom="m">
              <Text variant="subheader-lg">{t('history.title')}</Text>
            </Box>
          </Box>
        }
        renderItem={({ item }) => (
          <TransactionItem
            transaction={item}
            onPress={handleTransactionPress}
          />
        )}
        ListEmptyComponent={
          !isLoading ? (
            <Box marginTop="xl">
              <EmptyState
                icon="history"
                title={t('history.emptyTitle')}
                message={t('history.emptyMessage')}
              />
            </Box>
          ) : null
        }
        // Footer para dar aire al final, como en tu results.tsx
        ListFooterComponent={<Box height={50} />}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={loadData}
            tintColor={theme.colors.primary}
          />
        }
      />

      <BankConfigurationSheet ref={bankSheetRef} />
      <TransactionDetailSheet ref={detailSheetRef} transaction={selectedTx} />
    </Box>
  );
}
