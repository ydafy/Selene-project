import { create } from 'zustand';

import { Address } from '@selene/types';

export type CheckoutStatus =
  'idle' | 'validating' | 'processing' | 'success' | 'error';

interface PaymentSession {
  clientSecret: string;
  orderId: string;
  amount: number;
  transferGroup: string;
}

interface CheckoutState {
  // Datos
  selectedAddress: Address | null;
  selectedPaymentMethodId: string | null;

  // Single-connect-payment fields
  clientSecret: string | null;
  orderId: string | null;
  amount: number | null;
  transferGroup: string | null;

  // Estado del proceso
  status: CheckoutStatus;
  error: string | null;

  // Acciones
  setSelectedAddress: (address: Address | null) => void;
  setSelectedPaymentMethodId: (id: string | null) => void;
  setPaymentSession: (session: PaymentSession) => void;
  clearPaymentSession: () => void;
  setStatus: (status: CheckoutStatus) => void;
  setError: (error: string | null) => void;
  resetCheckout: () => void;

  // Selectores (Computed)
  isReady: () => boolean;
}

export const useCheckoutStore = create<CheckoutState>((set, get) => ({
  selectedAddress: null,
  selectedPaymentMethodId: null,
  clientSecret: null,
  orderId: null,
  amount: null,
  transferGroup: null,
  status: 'idle',
  error: null,

  setSelectedAddress: (address) => {
    if (
      address &&
      (!address.street_line1 ||
        !address.city ||
        !address.state ||
        !address.zip_code)
    ) {
      console.warn('[CHECKOUT] Dirección incompleta rechazada por seguridad.');
      return;
    }
    set({ selectedAddress: address, error: null });
  },

  setSelectedPaymentMethodId: (id) =>
    set({ selectedPaymentMethodId: id, error: null }),

  setPaymentSession: (session) =>
    set({
      amount: session.amount,
      clientSecret: session.clientSecret,
      orderId: session.orderId,
      transferGroup: session.transferGroup,
    }),

  clearPaymentSession: () =>
    set({
      amount: null,
      clientSecret: null,
      orderId: null,
      transferGroup: null,
    }),

  setStatus: (status) => set({ status }),

  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),

  resetCheckout: () =>
    set({
      selectedAddress: null,
      selectedPaymentMethodId: null,
      amount: null,
      clientSecret: null,
      orderId: null,
      transferGroup: null,
      status: 'idle',
      error: null,
    }),

  isReady: () => {
    const state = get();
    const hasAddress = !!state.selectedAddress;
    const hasPayment = !!state.selectedPaymentMethodId;
    const isNotProcessing = state.status !== 'processing';

    return hasAddress && hasPayment && isNotProcessing;
  },
}));
