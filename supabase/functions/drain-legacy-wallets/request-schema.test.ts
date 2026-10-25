import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { DrainLegacyWalletsRequestSchema } from './request-schema.ts';

describe('drain-legacy-wallets request schema', () => {
  it('defaults dryRun to false for an empty body', () => {
    expect(DrainLegacyWalletsRequestSchema.parse({})).toEqual({
      dryRun: false,
    });
  });

  it('keeps an explicit dryRun value', () => {
    expect(DrainLegacyWalletsRequestSchema.parse({ dryRun: true })).toEqual({
      dryRun: true,
    });
    expect(DrainLegacyWalletsRequestSchema.parse({ dryRun: false })).toEqual({
      dryRun: false,
    });
  });

  it('rejects a non-boolean dryRun with one invalid_type issue', () => {
    const result = DrainLegacyWalletsRequestSchema.safeParse({ dryRun: 'yes' });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'invalid_type',
      path: ['dryRun'],
    });
  });

  it('is the schema the entrypoint parses with', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain("from './request-schema.ts'");
    expect(source).toContain('DrainLegacyWalletsRequestSchema.parse(');
  });
});
