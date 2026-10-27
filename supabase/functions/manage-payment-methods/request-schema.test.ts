import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { ManagePaymentMethodsRequestSchema } from './request-schema.ts';

describe('manage-payment-methods request schema', () => {
  it('accepts each action, with an optional RFC 9562 payment method id', () => {
    for (const action of [
      'get_setup_config',
      'list_payment_methods',
      'delete_payment_method',
    ]) {
      expect(
        ManagePaymentMethodsRequestSchema.safeParse({ action }).data,
      ).toEqual({ action });
    }

    const request = {
      action: 'delete_payment_method',
      paymentMethodId: '00000000-0000-4000-8000-0000000000c1',
    };
    expect(ManagePaymentMethodsRequestSchema.safeParse(request).data).toEqual(
      request,
    );
  });

  it('rejects an unknown action with one invalid_value issue', () => {
    const result = ManagePaymentMethodsRequestSchema.safeParse({
      action: 'drop_everything',
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_value',
      path: ['action'],
    });
  });

  it('rejects a non-RFC payment method id, which zod 3 accepted', () => {
    const result = ManagePaymentMethodsRequestSchema.safeParse({
      action: 'delete_payment_method',
      paymentMethodId: '11111111-2222-3333-4444-555555555555',
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_format',
      format: 'uuid',
      path: ['paymentMethodId'],
    });
  });

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('ManagePaymentMethodsRequestSchema.parse(body)');
  });
});
