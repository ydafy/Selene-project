import { describe, expect, it, mock } from 'bun:test';

import { presentSinglePaymentSheet } from './checkoutPaymentFlow';

describe('presentSinglePaymentSheet', () => {
  it('initializes and presents the Stripe sheet exactly once', async () => {
    const initPaymentSheet = mock(async () => ({ error: null }));
    const presentPaymentSheet = mock(async () => ({ error: null }));

    const result = await presentSinglePaymentSheet({
      appearance: {
        colors: {
          background: '#fff',
          componentBackground: '#fff',
          componentBorder: '#ddd',
          componentDivider: '#ddd',
          componentText: '#111',
          error: '#f00',
          icon: '#00f',
          placeholderText: '#666',
          primary: '#00f',
          primaryText: '#111',
          secondaryText: '#666',
        },
        shapes: { borderRadius: 12 },
      },
      allowsDelayedPaymentMethods: false,
      customerEphemeralKeySecret: 'ek_test_1',
      customerId: 'cus_test_1',
      initPaymentSheet,
      merchantDisplayName: 'Selene Marketplace',
      paymentIntentClientSecret: 'cs_test_1',
      presentPaymentSheet,
    });

    expect(initPaymentSheet).toHaveBeenCalledTimes(1);
    expect(presentPaymentSheet).toHaveBeenCalledTimes(1);
    expect(initPaymentSheet.mock.calls[0]?.[0]).toMatchObject({
      customerEphemeralKeySecret: 'ek_test_1',
      customerId: 'cus_test_1',
      merchantDisplayName: 'Selene Marketplace',
      paymentIntentClientSecret: 'cs_test_1',
    });
    expect(result).toEqual({ success: true });
  });

  it('returns the init error without opening the sheet', async () => {
    const initPaymentSheet = mock(async () => ({
      error: { message: 'init failed' },
    }));
    const presentPaymentSheet = mock(async () => ({ error: null }));

    const result = await presentSinglePaymentSheet({
      appearance: {
        colors: {
          background: '#fff',
          componentBackground: '#fff',
          componentBorder: '#ddd',
          componentDivider: '#ddd',
          componentText: '#111',
          error: '#f00',
          icon: '#00f',
          placeholderText: '#666',
          primary: '#00f',
          primaryText: '#111',
          secondaryText: '#666',
        },
        shapes: { borderRadius: 12 },
      },
      allowsDelayedPaymentMethods: false,
      customerEphemeralKeySecret: 'ek_test_1',
      customerId: 'cus_test_1',
      initPaymentSheet,
      merchantDisplayName: 'Selene Marketplace',
      paymentIntentClientSecret: 'cs_test_1',
      presentPaymentSheet,
    });

    expect(initPaymentSheet).toHaveBeenCalledTimes(1);
    expect(presentPaymentSheet).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, message: 'init failed' });
  });

  it('surfaces sheet cancellation as a cancelled result', async () => {
    const initPaymentSheet = mock(async () => ({ error: null }));
    const presentPaymentSheet = mock(async () => ({
      error: { code: 'Canceled', message: 'Cancelled by user' },
    }));

    const result = await presentSinglePaymentSheet({
      appearance: {
        colors: {
          background: '#fff',
          componentBackground: '#fff',
          componentBorder: '#ddd',
          componentDivider: '#ddd',
          componentText: '#111',
          error: '#f00',
          icon: '#00f',
          placeholderText: '#666',
          primary: '#00f',
          primaryText: '#111',
          secondaryText: '#666',
        },
        shapes: { borderRadius: 12 },
      },
      allowsDelayedPaymentMethods: false,
      customerEphemeralKeySecret: 'ek_test_1',
      customerId: 'cus_test_1',
      initPaymentSheet,
      merchantDisplayName: 'Selene Marketplace',
      paymentIntentClientSecret: 'cs_test_1',
      presentPaymentSheet,
    });

    expect(result).toEqual({
      success: false,
      cancelled: true,
      message: 'Cancelled by user',
    });
  });
});
