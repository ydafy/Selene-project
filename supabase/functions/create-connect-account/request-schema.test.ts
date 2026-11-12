import { describe, expect, it } from 'bun:test';

import { CreateConnectAccountRequestSchema } from './request-schema.ts';

describe('create-connect-account request schema', () => {
  it('accepts an empty body and optional onboarding links', () => {
    expect(CreateConnectAccountRequestSchema.safeParse({}).data).toEqual({});
    expect(
      CreateConnectAccountRequestSchema.safeParse({
        refreshUrl: 'selene://refresh',
        returnUrl: 'selene://return',
      }).data,
    ).toEqual({ refreshUrl: 'selene://refresh', returnUrl: 'selene://return' });
  });

  it('rejects a non-string link with one invalid_type issue', () => {
    const result = CreateConnectAccountRequestSchema.safeParse({
      refreshUrl: 123,
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_type',
      path: ['refreshUrl'],
    });
  });
});
