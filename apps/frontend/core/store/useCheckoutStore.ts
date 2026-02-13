import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Address } from '@selene/types';

export type CheckoutStatus =
  | 'idle'
  | 'validating'
  | 'processing'
  | 'success'
  | 'error';

interface CheckoutState {
  // Datos
  selectedAddress: Address | null;
  selectedPaymentMethodId: string | null;

  // Estado del proceso
  status: CheckoutStatus;
  error: string | null;

  // Acciones
  setSelectedAddress: (address: Address | null) => void;
  setSelectedPaymentMethodId: (id: string | null) => void;
  setStatus: (status: CheckoutStatus) => void;
  setError: (error: string | null) => void;
  resetCheckout: () => void;

  // Selectores (Computed)
  isReady: () => boolean;
}

export const useCheckoutStore = create<CheckoutState>()(
  persist(
    (set, get) => ({
      selectedAddress: null,
      selectedPaymentMethodId: null,
      status: 'idle',
      error: null,

      setSelectedAddress: (address) => {
        // Validación: No permitir guardar si falta información crítica
        if (address && (!address.id || !address.zip_code)) return;
        set({ selectedAddress: address, error: null });
      },

      setSelectedPaymentMethodId: (id) =>
        set({ selectedPaymentMethodId: id, error: null }),

      setStatus: (status) => set({ status }),

      setError: (error) => set({ error, status: error ? 'error' : 'idle' }),

      resetCheckout: () =>
        set({
          selectedAddress: null,
          selectedPaymentMethodId: null,
          status: 'idle',
          error: null,
        }),

      // Lógica centralizada de validación
      isReady: () => {
        const state = get();
        const hasAddress = !!state.selectedAddress;
        const hasPayment = !!state.selectedPaymentMethodId;
        const isNotProcessing = state.status !== 'processing';

        return hasAddress && hasPayment && isNotProcessing;
      },
    }),
    {
      name: 'selene-checkout-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // FILTRO DE PERSISTENCIA: Solo guardamos lo que el usuario eligió
      // Ignoramos 'status' y 'error' para que siempre inicien limpios
      partialize: (state) => ({
        selectedAddress: state.selectedAddress,
        selectedPaymentMethodId: state.selectedPaymentMethodId,
      }),
    },
  ),
);
