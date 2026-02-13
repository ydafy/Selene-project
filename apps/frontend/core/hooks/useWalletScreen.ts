import { useEffect, useCallback } from 'react';
import { useWalletStore } from '../store/useWalletStore';

export const useWalletScreen = (userId: string | undefined) => {
  const {
    wallet,
    transactions,
    isLoading,
    bankAccount,
    error,
    fetchWallet,
    fetchTransactions,
    fetchBankAccount,
    subscribeToWallet,
    unsubscribeFromWallet,
  } = useWalletStore();

  const loadData = useCallback(async () => {
    if (userId) {
      // 1. Esperamos a que la wallet esté lista (o creada)
      await fetchWallet(userId);
      // 2. Ahora sí pedimos las transacciones con seguridad
      fetchTransactions();
      fetchBankAccount(userId);
    }
  }, [userId, fetchWallet, fetchTransactions, fetchBankAccount]);

  useEffect(() => {
    if (userId) {
      loadData();
      subscribeToWallet(userId);
    }
    return () => unsubscribeFromWallet();
  }, [userId, loadData, subscribeToWallet, unsubscribeFromWallet]);

  return { wallet, transactions, bankAccount, isLoading, error, loadData };
};
