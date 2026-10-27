import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { ReturnLabelRequestSchema } from './request-schema.ts';

describe('generate-return-label request schema', () => {
  it('accepts an RFC 9562 dispute id', () => {
    expect(
      ReturnLabelRequestSchema.safeParse({
        disputeId: '00000000-0000-4000-8000-0000000000e1',
      }).success,
    ).toBe(true);
  });

  it('keeps the Spanish message the return screen shows for a non-RFC dispute id', () => {
    const result = ReturnLabelRequestSchema.safeParse({
      disputeId: '11111111-2222-3333-4444-555555555555',
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_format',
      format: 'uuid',
      path: ['disputeId'],
      message: 'ID de disputa inválido',
    });
  });

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('ReturnLabelRequestSchema.parse(body)');
  });
});
