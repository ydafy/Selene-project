import { describe, expect, it } from 'bun:test';

import { ManagePaymentMethodsRequestSchema } from './request-schema.ts';

describe('manage-payment-methods request schema', () => {
  it('accepts exactly the two sheet actions', () => {
    for (const action of ['create_customer_session', 'create_setup_intent']) {
      expect(
        ManagePaymentMethodsRequestSchema.safeParse({ action }).data,
      ).toEqual({ action });
    }
  });

  it('drops a paymentMethodId: Selene no longer addresses a card by id', () => {
    expect(
      ManagePaymentMethodsRequestSchema.safeParse({
        action: 'create_setup_intent',
        paymentMethodId: '00000000-0000-4000-8000-0000000000c1',
      }).data,
    ).toEqual({ action: 'create_setup_intent' });
  });

  for (const action of [
    'list_payment_methods',
    'delete_payment_method',
    'get_setup_config',
    'drop_everything',
  ]) {
    it(`rejects ${action} with one invalid_value issue`, () => {
      const result = ManagePaymentMethodsRequestSchema.safeParse({ action });

      expect(result.error?.issues).toHaveLength(1);
      expect(result.error?.issues[0]).toMatchObject({
        code: 'invalid_value',
        path: ['action'],
      });
    });
  }
});
