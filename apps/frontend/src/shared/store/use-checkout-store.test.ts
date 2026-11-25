import { beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

const loadStore = async () => import('./use-checkout-store');

const address = {
  city: 'Monterrey',
  country: 'MX',
  created_at: '2026-07-04T00:00:00Z',
  deleted_at: null,
  id: 'addr-1',
  is_default: true,
  label: 'Home',
  latitude: null,
  longitude: null,
  phone_number: '8112345678',
  state: 'Nuevo León',
  street_line1: 'Calle 1',
  street_line2: null,
  updated_at: '2026-07-04T00:00:00Z',
  user_id: 'user-1',
  zip_code: '64000',
} as never;

describe('useCheckoutStore', () => {
  beforeEach(async () => {
    const { useCheckoutStore } = await loadStore();

    useCheckoutStore.setState({
      amount: null,
      clientSecret: null,
      error: null,
      orderId: null,
      selectedAddress: null,
      status: 'idle',
      transferGroup: null,
    });
  });

  it('stores a single payment session contract', async () => {
    const { useCheckoutStore } = await loadStore();

    useCheckoutStore.getState().setPaymentSession({
      amount: 85_100,
      clientSecret: 'cs_test_1',
      orderId: 'order-1',
      transferGroup: 'grp_order-1',
    });

    expect(useCheckoutStore.getState().clientSecret).toBe('cs_test_1');
    expect(useCheckoutStore.getState().orderId).toBe('order-1');
    expect(useCheckoutStore.getState().amount).toBe(85_100);
    expect(useCheckoutStore.getState().transferGroup).toBe('grp_order-1');
  });

  it('is ready with an address and no saved card selected', async () => {
    // The buyer chooses the card in Stripe PaymentSheet (S7d).
    const { useCheckoutStore } = await loadStore();

    expect(useCheckoutStore.getState().isReady()).toBe(false);

    useCheckoutStore.getState().setSelectedAddress(address);

    expect(useCheckoutStore.getState().isReady()).toBe(true);
  });

  it('keeps no card selection in the checkout state', async () => {
    const { useCheckoutStore } = await loadStore();
    const state = useCheckoutStore.getState() as unknown as Record<
      string,
      unknown
    >;

    expect(state.selectedPaymentMethodId).toBeUndefined();
    expect(state.setSelectedPaymentMethodId).toBeUndefined();
  });

  it('resets checkout state including the address selection', async () => {
    const { useCheckoutStore } = await loadStore();

    useCheckoutStore.getState().setSelectedAddress(address);
    useCheckoutStore.getState().setPaymentSession({
      amount: 85_100,
      clientSecret: 'cs_test_1',
      orderId: 'order-1',
      transferGroup: 'grp_order-1',
    });

    useCheckoutStore.getState().resetCheckout();

    expect(useCheckoutStore.getState().clientSecret).toBeNull();
    expect(useCheckoutStore.getState().orderId).toBeNull();
    expect(useCheckoutStore.getState().amount).toBeNull();
    expect(useCheckoutStore.getState().transferGroup).toBeNull();
    expect(useCheckoutStore.getState().selectedAddress).toBeNull();
    expect(useCheckoutStore.getState().status).toBe('idle');
  });
});
