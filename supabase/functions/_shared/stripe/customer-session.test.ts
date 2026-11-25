import { describe, expect, it } from 'bun:test';

import {
  CUSTOMER_SESSION_FAILED,
  createCustomerSheetSession,
  createPaymentSheetSession,
  stripeFailureReason,
  type CustomerSessionStripe,
} from './customer-session.ts';

function fakeStripe(
  answer: () => Promise<{ client_secret: string }> = async () => ({
    client_secret: 'cuss_secret_1',
  }),
) {
  const calls: unknown[] = [];
  const stripe: CustomerSessionStripe = {
    customerSessions: {
      create: async (params) => {
        calls.push(params);
        return answer();
      },
    },
  };
  return { stripe, calls };
}

const ALL_SAVED_CARDS = ['always', 'limited', 'unspecified'];

describe('createPaymentSheetSession', () => {
  it("lets PaymentSheet show, save and remove every saved card of the customer, and returns the session's client secret", async () => {
    const { stripe, calls } = fakeStripe();

    expect(await createPaymentSheetSession(stripe, 'cus_1')).toBe(
      'cuss_secret_1',
    );
    expect(calls).toEqual([
      {
        customer: 'cus_1',
        components: {
          mobile_payment_element: {
            enabled: true,
            features: {
              payment_method_redisplay: 'enabled',
              payment_method_save: 'enabled',
              payment_method_remove: 'enabled',
              payment_method_allow_redisplay_filters: ALL_SAVED_CARDS,
            },
          },
        },
      },
    ]);
  });
});

describe('createCustomerSheetSession', () => {
  it('lets CustomerSheet show and remove the same saved cards, and returns the client secret', async () => {
    const { stripe, calls } = fakeStripe();

    expect(await createCustomerSheetSession(stripe, 'cus_1')).toBe(
      'cuss_secret_1',
    );
    expect(calls).toEqual([
      {
        customer: 'cus_1',
        components: {
          customer_sheet: {
            enabled: true,
            features: {
              payment_method_remove: 'enabled',
              payment_method_allow_redisplay_filters: ALL_SAVED_CARDS,
            },
          },
        },
      },
    ]);
  });
});

describe('a CustomerSession that cannot be created', () => {
  for (const create of [
    createPaymentSheetSession,
    createCustomerSheetSession,
  ]) {
    it(`${create.name} throws CUSTOMER_SESSION_FAILED with the Stripe error as cause`, async () => {
      const stripeError = new Error('No such customer: cus_1');
      const { stripe } = fakeStripe(async () => {
        throw stripeError;
      });

      const error = await create(stripe, 'cus_1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(CUSTOMER_SESSION_FAILED);
      expect((error as Error).cause).toBe(stripeError);
    });

    it(`${create.name} throws CUSTOMER_SESSION_FAILED when Stripe returns no client secret`, async () => {
      const { stripe } = fakeStripe(async () => ({ client_secret: '' }));

      const error = await create(stripe, 'cus_1').catch((e: unknown) => e);

      expect((error as Error).message).toBe(CUSTOMER_SESSION_FAILED);
    });
  }
});

describe('stripeFailureReason', () => {
  it("reads the wrapped Stripe error's message, the error's own message, or the value", () => {
    expect(
      stripeFailureReason(
        new Error(CUSTOMER_SESSION_FAILED, {
          cause: new Error('No such customer'),
        }),
      ),
    ).toBe('No such customer');
    expect(stripeFailureReason(new Error('rate limited'))).toBe('rate limited');
    expect(stripeFailureReason('no client secret')).toBe('no client secret');
  });
});
