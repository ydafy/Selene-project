import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { ConnectEarningsRequestSchema } from './request-schema.ts';

describe('get-connect-earnings request schema', () => {
  it('accepts an empty body and trims the search before its 120-character bound', () => {
    expect(ConnectEarningsRequestSchema.parse({})).toEqual({});
    expect(
      ConnectEarningsRequestSchema.parse({ search: `  ${'a'.repeat(120)}  ` }),
    ).toEqual({ search: 'a'.repeat(120) });
  });

  it('rejects a search longer than 120 characters with one too_big issue', () => {
    const result = ConnectEarningsRequestSchema.safeParse({
      search: 'a'.repeat(121),
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'too_big',
      maximum: 120,
      path: ['search'],
    });
  });

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('ConnectEarningsRequestSchema.parse(');
  });
});
