import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { ResolveDisputeRequestSchema } from './request-schema.ts';

const validRequest = {
  disputeId: '00000000-0000-4000-8000-0000000000e1',
  verdict: 'buyer',
  adminNote: 'Evidence supports the buyer',
};

describe('resolve-dispute request schema', () => {
  it('accepts an RFC 9562 dispute id, a verdict and a descriptive note', () => {
    expect(ResolveDisputeRequestSchema.safeParse(validRequest).data).toEqual(
      validRequest,
    );
    expect(
      ResolveDisputeRequestSchema.safeParse({
        ...validRequest,
        verdict: 'seller',
      }).success,
    ).toBe(true);
  });

  it('rejects a non-RFC dispute id, which zod 3 accepted', () => {
    const result = ResolveDisputeRequestSchema.safeParse({
      ...validRequest,
      disputeId: '11111111-2222-3333-4444-555555555555',
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_format',
      format: 'uuid',
      path: ['disputeId'],
    });
  });

  it('rejects a verdict outside buyer and seller', () => {
    const result = ResolveDisputeRequestSchema.safeParse({
      ...validRequest,
      verdict: 'split',
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_value',
      path: ['verdict'],
    });
  });

  it('keeps the Spanish message for a note under five characters', () => {
    const result = ResolveDisputeRequestSchema.safeParse({
      ...validRequest,
      adminNote: 'ok',
    });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'too_small',
      path: ['adminNote'],
      message: 'La nota del administrador es obligatoria y debe ser descriptiva',
    });
  });

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('ResolveDisputeRequestSchema.parse(body)');
  });
});
