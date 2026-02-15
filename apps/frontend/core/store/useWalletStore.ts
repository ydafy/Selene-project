import { create } from 'zustand';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../core/db/supabase';
import {
  Wallet,
  WalletTransaction,
  SellerBankAccount,
} from '../../../../packages/types/src/index';

interface WalletState {
  wallet: Wallet | null;
  transactions: WalletTransaction[];
  isLoading: boolean;
  isActionLoading: boolean;
  error: string | null;
  bankAccount: SellerBankAccount | null;

  // Actions
  fetchWallet: (userId: string) => Promise<void>;
  fetchTransactions: () => Promise<void>;
  subscribeToWallet: (userId: string) => void;
  unsubscribeFromWallet: () => void;
  requestPayout: (
    amount: number,
    bankAccountId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  clearWallet: () => void;
  fetchBankAccount: (userId: string) => Promise<void>;
  saveBankAccount: (
    userId: string,
    clabe: string,
    holderName: string,
    bankName: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

let walletSubscription: RealtimeChannel | null = null;

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  transactions: [],
  isLoading: false,
  isActionLoading: false,
  error: null,
  bankAccount: null,

  fetchBankAccount: async (userId) => {
    try {
      const { data, error } = await supabase
        .from('seller_bank_accounts')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      set({ bankAccount: data as SellerBankAccount });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al cargar cuenta bancaria';
      console.error('Error fetching bank account:', message);
    }
  },

  saveBankAccount: async (userId, clabe, holderName, bankName) => {
    set({ isActionLoading: true });
    try {
      // Upsert: Si ya existe, actualiza. Si no, crea.
      const { data, error } = await supabase
        .from('seller_bank_accounts')
        .upsert(
          {
            user_id: userId,
            clabe,
            account_holder_name: holderName,
            bank_name: bankName,
            is_verified: true, // Asumimos verificado por algoritmo por ahora
          },
          { onConflict: 'user_id' },
        )
        .select()
        .single();

      if (error) throw error;

      set({ bankAccount: data as SellerBankAccount, isActionLoading: false });
      return { success: true };
    } catch (err) {
      set({ isActionLoading: false });
      const message =
        err instanceof Error ? err.message : 'Error al guardar cuenta bancaria';
      return { success: false, error: message };
    }
  },

  fetchWallet: async (userId) => {
    if (!userId) return;
    set({ isLoading: true, error: null });

    try {
      // 1. Intentar obtener la wallet
      const { data, error } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(); // Usamos maybeSingle para que no explote si no hay nada

      if (error) throw error;

      if (data) {
        // Caso A: La wallet existe
        set({ wallet: data as Wallet, isLoading: false });
      } else {
        // Caso B: La wallet NO existe (usuario viejo). La creamos proactivamente.
        console.log('Wallet not found for existing user, creating one...');
        const { data: newWallet, error: createError } = await supabase
          .from('wallets')
          .insert({ user_id: userId })
          .select()
          .single();

        if (createError) throw createError;
        set({ wallet: newWallet as Wallet, isLoading: false });
      }
    } catch (err) {
      console.error('--- WALLET ERROR DEBUG ---', err);
      const message =
        err instanceof Error ? err.message : 'Error al cargar billetera';
      set({ error: message, isLoading: false });
    }
  },

  fetchTransactions: async () => {
    const { wallet } = get();
    // RLS Safety: Usamos el wallet_id que ya tenemos cargado
    if (!wallet?.id) return;

    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select(
          `
          *,
          order:orders(id, status)
        `,
        )
        .eq('wallet_id', wallet.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Protección contra Race Conditions: Solo setear si el wallet sigue siendo el mismo
      if (get().wallet?.id === wallet.id) {
        set({
          transactions: (data ?? []) as WalletTransaction[],
          isLoading: false,
        });
      } else {
        // Race condition detectado, limpiar loading igual
        set({ isLoading: false });
      }
    } catch (err) {
      console.error('--- WALLET ERROR DEBUG ---', err);
      const message =
        err instanceof Error ? err.message : 'Error al cargar transacciones';
      set({ error: message, isLoading: false });
    }
  },

  subscribeToWallet: (userId) => {
    if (walletSubscription) return;

    const setupSubscription = () => {
      walletSubscription = supabase
        .channel(`wallet_changes_${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'wallets',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const newWallet = payload.new as Record<string, unknown>;
            // Validación básica de que el payload tiene la estructura esperada
            if (
              newWallet &&
              typeof newWallet === 'object' &&
              'id' in newWallet
            ) {
              set({ wallet: newWallet as unknown as Wallet });
            }
          },
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            console.error('Wallet Realtime Error. Retrying in 5s...');
            set({ error: 'Realtime connection lost' });
            // Retry logic
            setTimeout(() => {
              get().unsubscribeFromWallet();
              setupSubscription();
            }, 5000);
          }
        });
    };

    setupSubscription();
  },

  requestPayout: async (amount: number, bankAccountId: string) => {
    const { wallet } = get();

    // 1. Validación previa en cliente (UX)
    if (!wallet || wallet.available_balance < amount) {
      return { success: false, error: 'INSUFFICIENT_FUNDS' };
    }

    // 2. Optimistic Update: Bajamos el saldo en la UI para feedback instantáneo
    const previousBalance = wallet.available_balance;
    set({
      isActionLoading: true,
      wallet: { ...wallet, available_balance: previousBalance - amount },
    });

    try {
      // 3. LLAMADA RPC (La verdad está en el servidor)
      const { data, error } = await supabase.rpc('fn_request_payout', {
        p_user_id: wallet.user_id,
        p_wallet_id: wallet.id,
        p_amount: amount,
        p_bank_account_id: bankAccountId,
      });

      if (error) throw error;

      // 4. Verificar respuesta de la función SQL
      // Nota: Supabase RPC devuelve un array o el tipo de retorno de la función
      const result = Array.isArray(data) ? data[0] : data;

      if (!result?.success) {
        throw new Error(result?.error_message || 'ERROR_IN_DATABASE');
      }

      set({ isActionLoading: false });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error en el retiro';
      console.error('--- PAYOUT CRITICAL ERROR ---', err);

      set({
        isActionLoading: false,
        wallet: { ...wallet, available_balance: previousBalance },
        error: message,
      });
      return { success: false, error: message };
    }
  },

  unsubscribeFromWallet: () => {
    if (walletSubscription) {
      supabase.removeChannel(walletSubscription);
      walletSubscription = null;
    }
  },

  clearWallet: () => {
    get().unsubscribeFromWallet();
    set({
      wallet: null,
      transactions: [],
      bankAccount: null, // Limpieza completa
      error: null,
      isLoading: false,
    });
  },
}));
