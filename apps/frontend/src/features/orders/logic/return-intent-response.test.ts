import { describe, expect, it } from 'bun:test';

import { parseReturnIntentResponse } from './return-intent-response';

describe('parseReturnIntentResponse', () => {
  it('returns the PaymentSheet secrets with the CustomerSession', () => {
    expect(
      parseReturnIntentResponse({
        clientSecret: 'pi_1_secret_2',
        customer: 'cus_1',
        customerSessionClientSecret: 'cuss_secret_1',
      }),
    ).toEqual({
      paymentIntentClientSecret: 'pi_1_secret_2',
      customerId: 'cus_1',
      customerSessionClientSecret: 'cuss_secret_1',
    });
  });

  it('rejects a response with an ephemeral key instead of a CustomerSession', () => {
    expect(() =>
      parseReturnIntentResponse({
        clientSecret: 'pi_1_secret_2',
        customer: 'cus_1',
        ephemeralKey: 'ek_1',
      }),
    ).toThrow();
  });

  it('rejects a response without a PaymentIntent client secret', () => {
    expect(() =>
      parseReturnIntentResponse({
        customer: 'cus_1',
        customerSessionClientSecret: 'cuss_secret_1',
      }),
    ).toThrow();
  });
});
