import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

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

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('CreateConnectAccountRequestSchema.parse(body)');
  });
});
