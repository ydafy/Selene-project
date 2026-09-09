import { beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

const loadStore = async () => import('./useCheckoutStore');

describe('useCheckoutStore', () => {
  beforeEach(async () => {
    const { useCheckoutStore } = await loadStore();

    useCheckoutStore.setState({
      amount: null,
      clientSecret: null,
      error: null,
      orderId: null,
      selectedAddress: null,
      selectedPaymentMethodId: null,
      status: 'idle',
      transferGroup: null,
    } as never);
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

  it('resets checkout state including address and payment method selections', async () => {
    const { useCheckoutStore } = await loadStore();

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

    useCheckoutStore.getState().setSelectedAddress(address);
    useCheckoutStore.getState().setSelectedPaymentMethodId('pm_1');
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
    expect(useCheckoutStore.getState().selectedPaymentMethodId).toBeNull();
    expect(useCheckoutStore.getState().status).toBe('idle');
  });
});
