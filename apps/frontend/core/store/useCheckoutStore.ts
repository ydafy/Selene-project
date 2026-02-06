import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Address } from '@selene/types';

interface CheckoutState {
  // Dirección de entrega
  selectedAddress: Address | null;
  setSelectedAddress: (address: Address | null) => void;

  // Método de pago (Stripe Payment Method ID)
  selectedPaymentMethodId: string | null;
  setSelectedPaymentMethodId: (id: string | null) => void;

  // Limpieza del proceso
  resetCheckout: () => void;
}

/**
 * Checkout State Store
 * Centraliza la dirección y el pago para el flujo de compra.
 * Persiste los datos para evitar pérdida de progreso al cerrar la app.
 */
export const useCheckoutStore = create<CheckoutState>()(
  persist(
    (set) => ({
      selectedAddress: null,
      selectedPaymentMethodId: null,

      setSelectedAddress: (address) => set({ selectedAddress: address }),

      setSelectedPaymentMethodId: (id) => set({ selectedPaymentMethodId: id }),

      resetCheckout: () =>
        set({
          selectedAddress: null,
          selectedPaymentMethodId: null,
        }),
    }),
    {
      name: 'selene-checkout-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
