import { describe, expect, test } from 'bun:test';

import {
  type GenerateResult,
  type TypesDeps,
  runDatabaseTypes,
  TYPES_PATH,
} from './database-types';

const GENERATED = 'export type Database = {"public":{Tables:{}}}\n';
const FORMATTED = 'export type Database = { public: { Tables: {} } };\n';

function fakeDeps(
  generated: GenerateResult,
  committed: string | null = null,
): TypesDeps & { written: string[]; formatted: string[] } {
  const written: string[] = [];
  const formatted: string[] = [];
  return {
    written,
    formatted,
    generate: () => generated,
    format: async (source) => {
      formatted.push(source);
      return FORMATTED;
    },
    readCommitted: () => committed,
    writeCommitted: (content) => {
      written.push(content);
    },
  };
}

describe('runDatabaseTypes write mode', () => {
  test('writes the formatted output of the local generator', async () => {
    const deps = fakeDeps({ exitCode: 0, stdout: GENERATED, stderr: '' });

    const result = await runDatabaseTypes('write', deps);

    expect(result).toEqual({ ok: true, message: `Wrote ${TYPES_PATH}.` });
    expect(deps.formatted).toEqual([GENERATED]);
    expect(deps.written).toEqual([FORMATTED]);
  });

  test('fails without writing when the generator exits non-zero', async () => {
    const deps = fakeDeps({
      exitCode: 1,
      stdout: '',
      stderr: 'failed to connect to postgres',
    });

    const result = await runDatabaseTypes('write', deps);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      'supabase gen types failed (exit 1). Is the local stack running (`supabase start`)?\nfailed to connect to postgres',
    );
    expect(deps.written).toEqual([]);
  });

  test('fails without writing when the generator prints no Database type', async () => {
    const deps = fakeDeps({ exitCode: 0, stdout: '', stderr: '' });

    const result = await runDatabaseTypes('write', deps);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      'supabase gen types printed no `Database` type; nothing was written.',
    );
    expect(deps.formatted).toEqual([]);
    expect(deps.written).toEqual([]);
  });
});
