import { describe, expect, test } from 'bun:test';

import {
  type GenerateResult,
  type TypesDeps,
  parseMode,
  runDatabaseTypes,
  TYPES_PATH,
} from './database-types';

describe('parseMode', () => {
  test('writes without arguments and checks with --check', () => {
    expect(parseMode([])).toBe('write');
    expect(parseMode(['--check'])).toBe('check');
  });

  test('rejects any other argument instead of writing', () => {
    expect(() => parseMode(['--chek'])).toThrow(
      'Unknown argument: --chek. Usage: database-types.ts [--check]',
    );
  });
});

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

const OK_GENERATION = { exitCode: 0, stdout: GENERATED, stderr: '' };
const FIX_HINT =
  'Run `supabase db reset` and `bun run db:types`, then commit the file with its migration.';

describe('runDatabaseTypes check mode', () => {
  test('passes without writing when the committed file matches', async () => {
    const deps = fakeDeps(OK_GENERATION, FORMATTED);

    const result = await runDatabaseTypes('check', deps);

    expect(result).toEqual({
      ok: true,
      message: `${TYPES_PATH} matches the local database.`,
    });
    expect(deps.written).toEqual([]);
  });

  test('ignores CRLF line endings in the committed file', async () => {
    const deps = fakeDeps(OK_GENERATION, FORMATTED.replaceAll('\n', '\r\n'));

    const result = await runDatabaseTypes('check', deps);

    expect(result.ok).toBe(true);
  });

  test('fails without writing and names the first differing line', async () => {
    const stale = 'export type Database = { public: { Tables: {} } };\nextra\n';
    const deps = fakeDeps(OK_GENERATION, `// header\n${stale}`);

    const result = await runDatabaseTypes('check', deps);

    expect(result).toEqual({
      ok: false,
      message: `${TYPES_PATH} does not match the local database (first difference at line 1).\n${FIX_HINT}`,
    });
    expect(deps.written).toEqual([]);
  });

  test('fails when the committed file is missing', async () => {
    const deps = fakeDeps(OK_GENERATION, null);

    const result = await runDatabaseTypes('check', deps);

    expect(result).toEqual({
      ok: false,
      message: `${TYPES_PATH} is missing.\n${FIX_HINT}`,
    });
    expect(deps.written).toEqual([]);
  });

  test('fails without writing when the generator exits non-zero', async () => {
    const deps = fakeDeps(
      { exitCode: 1, stdout: '', stderr: 'boom' },
      FORMATTED,
    );

    const result = await runDatabaseTypes('check', deps);

    expect(result.ok).toBe(false);
    expect(result.message).toStartWith('supabase gen types failed (exit 1).');
    expect(deps.written).toEqual([]);
  });
});
