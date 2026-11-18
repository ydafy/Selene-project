import { describe, expect, it } from 'bun:test';

import { checkoutValidationSchema } from './checkout-schema';

const ADDRESS_ID = '3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f';

describe('checkoutValidationSchema', () => {
  it('accepts an address and accepted terms without a payment method', () => {
    // The buyer chooses the card in Stripe PaymentSheet, not before (S7d).
    const result = checkoutValidationSchema.safeParse({
      addressId: ADDRESS_ID,
      isTermsAccepted: true,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a checkout without an address', () => {
    const result = checkoutValidationSchema.safeParse({
      addressId: undefined,
      isTermsAccepted: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a checkout whose terms are not accepted', () => {
    const result = checkoutValidationSchema.safeParse({
      addressId: ADDRESS_ID,
      isTermsAccepted: false,
    });

    expect(result.success).toBe(false);
  });
});
