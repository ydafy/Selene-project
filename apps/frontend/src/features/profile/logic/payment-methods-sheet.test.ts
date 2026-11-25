import { describe, expect, it, mock } from 'bun:test';

import {
  customerSheetOutcome,
  preparePaymentMethodsSession,
  type ManagePaymentMethodsInvoke,
} from './payment-methods-sheet';

type Reply = unknown | Error;

/** Answers each action from its own queue; an `Error` entry is thrown. */
const invokeAnswering = (replies: {
  create_customer_session?: Reply[];
  create_setup_intent?: Reply[];
}) =>
  mock<ManagePaymentMethodsInvoke>(async (_name, body) => {
    const reply = replies[body.action]?.shift();
    if (reply === undefined) throw new Error(`unexpected ${body.action}`);
    if (reply instanceof Error) throw reply;
    return reply;
  });

const session = (n: number) => ({
  customerId: 'cus_1',
  customerSessionClientSecret: `cuss_secret_${n}`,
});
const setupIntent = (n: number) => ({
  setupIntentClientSecret: `seti_${n}_secret_${n}`,
});
const actions = (invoke: ReturnType<typeof invokeAnswering>) =>
  invoke.mock.calls.map(([name, body]) => `${name}:${body.action}`);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const PENDING = Symbol('pending');
const settledWithin = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<typeof PENDING>((resolve) =>
      setTimeout(() => resolve(PENDING), ms),
    ),
  ]);

describe('preparePaymentMethodsSession', () => {
  it('requests the SetupIntent only after the CustomerSession answered, so both use the same customer', async () => {
    let sessionAnswered = false;
    const setupIntentAfterSession: boolean[] = [];
    const invoke = mock<ManagePaymentMethodsInvoke>(async (_name, body) => {
      if (body.action === 'create_customer_session') {
        await flush();
        sessionAnswered = true;
        return session(1);
      }
      setupIntentAfterSession.push(sessionAnswered);
      return setupIntent(1);
    });

    await preparePaymentMethodsSession(invoke);

    expect(setupIntentAfterSession).toEqual([true]);
  });

  it('fetches a CustomerSession and a SetupIntent before the sheet opens', async () => {
    const invoke = invokeAnswering({
      create_customer_session: [session(1)],
      create_setup_intent: [setupIntent(1)],
    });

    const prepared = await preparePaymentMethodsSession(invoke);

    expect(actions(invoke).sort()).toEqual([
      'manage-payment-methods:create_customer_session',
      'manage-payment-methods:create_setup_intent',
    ]);
    await expect(
      prepared.clientSecretProvider.provideCustomerSessionClientSecret(),
    ).resolves.toEqual({ customerId: 'cus_1', clientSecret: 'cuss_secret_1' });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(prepared.setupIntentFailed()).toBe(false);
  });

  it.each([
    [
      'the CustomerSession request fails',
      new Error('STRIPE_REQUEST_FAILED'),
      setupIntent(1),
    ],
    [
      'the SetupIntent request fails',
      session(1),
      new Error('STRIPE_REQUEST_FAILED'),
    ],
    [
      'the CustomerSession response has no client secret',
      { customerId: 'cus_1', ephemeralKey: 'ek_1' },
      setupIntent(1),
    ],
    [
      'the SetupIntent response has no client secret',
      session(1),
      { setupIntent: 'seti_1_secret_1' },
    ],
  ])(
    'rejects, so the sheet never opens, when %s',
    async (_case, sessionReply, setupReply) => {
      const invoke = invokeAnswering({
        create_customer_session: [sessionReply],
        create_setup_intent: [setupReply],
      });

      await expect(preparePaymentMethodsSession(invoke)).rejects.toThrow();
    },
  );

  it('hands out the prefetched SetupIntent and fetches the next one for a second card', async () => {
    const invoke = invokeAnswering({
      create_customer_session: [session(1)],
      create_setup_intent: [setupIntent(1), setupIntent(2), setupIntent(3)],
    });
    const { clientSecretProvider, setupIntentFailed } =
      await preparePaymentMethodsSession(invoke);

    await expect(
      clientSecretProvider.provideSetupIntentClientSecret(),
    ).resolves.toBe('seti_1_secret_1');
    await flush();
    expect(invoke).toHaveBeenCalledTimes(3);
    await expect(
      clientSecretProvider.provideSetupIntentClientSecret(),
    ).resolves.toBe('seti_2_secret_2');
    expect(setupIntentFailed()).toBe(false);
  });

  it('fetches again when the add starts if the background SetupIntent request failed', async () => {
    const invoke = invokeAnswering({
      create_customer_session: [session(1)],
      create_setup_intent: [
        setupIntent(1),
        new Error('network'),
        setupIntent(3),
        setupIntent(4),
      ],
    });
    const { clientSecretProvider, setupIntentFailed } =
      await preparePaymentMethodsSession(invoke);

    await clientSecretProvider.provideSetupIntentClientSecret();
    await expect(
      clientSecretProvider.provideSetupIntentClientSecret(),
    ).resolves.toBe('seti_3_secret_3');
    expect(setupIntentFailed()).toBe(false);
  });

  it('never rejects into the SDK and records the failure when no SetupIntent can be fetched', async () => {
    const invoke = invokeAnswering({
      create_customer_session: [session(1)],
      create_setup_intent: [
        setupIntent(1),
        new Error('network'),
        { setupIntent: 'malformed' },
      ],
    });
    const { clientSecretProvider, setupIntentFailed } =
      await preparePaymentMethodsSession(invoke);
    await clientSecretProvider.provideSetupIntentClientSecret();

    const second = clientSecretProvider.provideSetupIntentClientSecret();

    expect(await settledWithin(second, 20)).toBe(PENDING);
    expect(setupIntentFailed()).toBe(true);
    expect(
      actions(invoke).filter((a) => a.endsWith('setup_intent')),
    ).toHaveLength(3);
  });

  it('asks for a new CustomerSession when the sheet requests another one', async () => {
    const invoke = invokeAnswering({
      create_customer_session: [session(1), session(2), new Error('expired')],
      create_setup_intent: [setupIntent(1)],
    });
    const { clientSecretProvider } = await preparePaymentMethodsSession(invoke);

    await clientSecretProvider.provideCustomerSessionClientSecret();
    await expect(
      clientSecretProvider.provideCustomerSessionClientSecret(),
    ).resolves.toEqual({ customerId: 'cus_1', clientSecret: 'cuss_secret_2' });
    // The SDK catches this rejection and passes it to the native sheet.
    await expect(
      clientSecretProvider.provideCustomerSessionClientSecret(),
    ).rejects.toThrow('expired');
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
