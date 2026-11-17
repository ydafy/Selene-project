import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findIgnoresWithoutReason, selectMigrations } from './lint-migrations';

const SCRIPT = join(import.meta.dir, 'lint-migrations.ts');
const REPO_ROOT = join(import.meta.dir, '..', '..');

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function migration(name: string, sql: string): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-migrations-'));
  roots.push(root);
  const path = join(root, name);
  writeFileSync(path, sql);
  return path;
}

function lint(...args: string[]) {
  const run = Bun.spawnSync(['bun', SCRIPT, ...args], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: run.exitCode,
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
  };
}

describe('findIgnoresWithoutReason', () => {
  it('accepts a squawk-ignore with a reason on the line above', () => {
    const sql = [
      '-- reason: pre-launch, no installed app reads label_url (#644)',
      '-- squawk-ignore ban-drop-column',
      'ALTER TABLE public.shipments DROP COLUMN label_url;',
    ].join('\n');
    expect(findIgnoresWithoutReason('a.sql', sql)).toEqual([]);
  });

  it.each([
    ['no comment above', ['-- squawk-ignore ban-drop-column']],
    ['an empty reason', ['-- reason:', '-- squawk-ignore ban-drop-column']],
    [
      'a blank line between',
      ['-- reason: dropped on purpose', '', '-- squawk-ignore ban-drop-column'],
    ],
    [
      'a file-wide ignore',
      ['ALTER TABLE t ADD COLUMN a text;', '-- squawk-ignore-file'],
    ],
  ])('rejects an ignore with %s', (_case, lines) => {
    const line = lines.length;
    expect(findIgnoresWithoutReason('a.sql', lines.join('\r\n'))).toEqual([
      `a.sql:${line}: squawk-ignore needs a "-- reason: <why>" comment on the line above it.`,
    ]);
  });
});

describe('selectMigrations', () => {
  it('keeps only top-level SQL migrations', () => {
    expect(
      selectMigrations([
        'supabase/migrations/20261120000000_a.sql',
        'supabase/migrations/archive/20260919090000_old.sql',
        'supabase/migrations/README.md',
        'supabase/schemas/public/tables/orders.sql',
        '',
      ]),
    ).toEqual(['supabase/migrations/20261120000000_a.sql']);
  });
});

describe('lint-migrations CLI', () => {
  it('fails on a blocking rule and names it', () => {
    const file = migration(
      'drop.sql',
      'ALTER TABLE public.shipments DROP COLUMN label_url;\n',
    );
    const result = lint(file);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('ban-drop-column');
  });

  it('passes the lock-duration rules the config excludes', () => {
    const file = migration(
      'locks.sql',
      [
        'CREATE INDEX shipments_status_idx ON public.shipments (status);',
        'ALTER TABLE public.shipments ALTER COLUMN status SET NOT NULL;',
        'ALTER TABLE public.shipments ADD CONSTRAINT amount_positive CHECK (amount > 0);',
        '',
      ].join('\n'),
    );
    const result = lint(file);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('passes an ignored rule that carries its reason', () => {
    const file = migration(
      'ignored.sql',
      [
        '-- reason: pre-launch, no installed app reads label_url (#644)',
        '-- squawk-ignore ban-drop-column',
        'ALTER TABLE public.shipments DROP COLUMN label_url;',
        '',
      ].join('\n'),
    );
    expect(lint(file).exitCode).toBe(0);
  });

  it('fails an ignore without a reason even when Squawk passes', () => {
    const file = migration(
      'no-reason.sql',
      [
        '-- squawk-ignore ban-drop-column',
        'ALTER TABLE public.shipments DROP COLUMN label_url;',
        '',
      ].join('\n'),
    );
    const result = lint(file);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `${file}:1: squawk-ignore needs a "-- reason: <why>" comment on the line above it.`,
    );
  });

  it('passes with nothing to lint', () => {
    const result = lint();
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'lint-migrations: no new migrations to lint.\n',
      stderr: '',
    });
  });

  it('rejects an unknown flag', () => {
    const result = lint('--bogus');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'Usage: bun scripts/ci/lint-migrations.ts [--base <commit>] [file.sql ...]',
    );
  });
});
