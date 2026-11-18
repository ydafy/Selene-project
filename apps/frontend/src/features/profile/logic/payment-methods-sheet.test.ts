import { describe, expect, it, mock } from 'bun:test';

import {
  createPaymentMethodsSecretProvider,
  customerSheetOutcome,
  type ManagePaymentMethodsInvoke,
} from './payment-methods-sheet';

const invokeReturning = (response: unknown) =>
  mock<ManagePaymentMethodsInvoke>(async () => response);

describe('createPaymentMethodsSecretProvider', () => {
  it('asks manage-payment-methods for a CustomerSession and returns it for CustomerSheet', async () => {
    const invoke = invokeReturning({
      customerId: 'cus_1',
      customerSessionClientSecret: 'cuss_secret_1',
    });
    const provider = createPaymentMethodsSecretProvider(invoke);

    await expect(
      provider.provideCustomerSessionClientSecret(),
    ).resolves.toEqual({ customerId: 'cus_1', clientSecret: 'cuss_secret_1' });
    expect(invoke.mock.calls).toEqual([
      ['manage-payment-methods', { action: 'create_customer_session' }],
    ]);
  });

  it('asks manage-payment-methods for a SetupIntent and returns its client secret', async () => {
    const invoke = invokeReturning({
      setupIntentClientSecret: 'seti_1_secret_2',
    });
    const provider = createPaymentMethodsSecretProvider(invoke);

    await expect(provider.provideSetupIntentClientSecret()).resolves.toBe(
      'seti_1_secret_2',
    );
    expect(invoke.mock.calls).toEqual([
      ['manage-payment-methods', { action: 'create_setup_intent' }],
    ]);
  });

  it('rejects a CustomerSession response without a client secret', async () => {
    const provider = createPaymentMethodsSecretProvider(
      invokeReturning({ customerId: 'cus_1', ephemeralKey: 'ek_1' }),
    );

    await expect(
      provider.provideCustomerSessionClientSecret(),
    ).rejects.toThrow();
  });

  it('rejects a SetupIntent response without a client secret', async () => {
    const provider = createPaymentMethodsSecretProvider(
      invokeReturning({ setupIntent: 'seti_1_secret_2' }),
    );

    await expect(provider.provideSetupIntentClientSecret()).rejects.toThrow();
  });

  it('propagates an Edge Function failure', async () => {
    const provider = createPaymentMethodsSecretProvider(
      mock<ManagePaymentMethodsInvoke>(async () => {
        throw new Error('STRIPE_REQUEST_FAILED');
      }),
    );

    await expect(provider.provideCustomerSessionClientSecret()).rejects.toThrow(
      'STRIPE_REQUEST_FAILED',
    );
  });
});

describe('customerSheetOutcome', () => {
  it('treats a cancelled sheet as closed without an error', () => {
    expect(
      customerSheetOutcome({
        error: { code: 'Canceled', message: 'cancelled' } as never,
      }),
    ).toBe('closed');
  });

  it('treats a closed sheet with or without a selection as closed', () => {
    expect(customerSheetOutcome({})).toBe('closed');
    expect(
      customerSheetOutcome({
        paymentOption: { label: '•••• 4242', image: '' },
      }),
    ).toBe('closed');
  });

  it('reports a failed sheet as an error', () => {
    expect(
      customerSheetOutcome({
        error: { code: 'Failed', message: 'network' } as never,
      }),
    ).toBe('failed');
  });
});
