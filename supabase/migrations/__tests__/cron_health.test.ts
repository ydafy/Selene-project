import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for fn_cron_health (cron-watchdog read model). These tests
 * read SQL text; `supabase db reset` is what proves the SQL runs in PostgreSQL.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const CANONICAL_PATH = join(
  import.meta.dir,
  '..',
  '..',
  'queries',
  'maintenance',
  'fn_cron_health.sql',
);

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('_cron_health.sql'));
  if (files.length !== 1) {
    throw new Error(`Expected exactly one *_cron_health.sql, found ${files.length}`);
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const normalize = (sql: string): string => stripComments(sql).replace(/\s+/g, ' ').trim();

describe('fn_cron_health migration', () => {
  const migration = findMigration();
  const canonical = readFileSync(CANONICAL_PATH, 'utf8');

  test.each([
    ['migration', migration],
    ['canonical file', canonical],
  ])('%s defines a SECURITY DEFINER function with a pinned search_path', (_, sql) => {
    const code = stripComments(sql);
    expect(code).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_cron_health\s*\(\s*\)/i);
    expect(code).toMatch(/SECURITY\s+DEFINER/i);
    expect(code).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*pg_temp/i);
  });

  test.each([
    ['migration', migration],
    ['canonical file', canonical],
  ])('%s returns exactly jobname, schedule, active, last_start, last_status', (_, sql) => {
    const returns = normalize(sql).match(/RETURNS TABLE\s*\((.*?)\) LANGUAGE/i);
    expect(returns).not.toBeNull();
    const columns = returns![1].split(',').map((c) => c.trim().split(' ')[0]);
    expect(columns).toEqual(['jobname', 'schedule', 'active', 'last_start', 'last_status']);
  });

  test.each([
    ['migration', migration],
    ['canonical file', canonical],
  ])('%s never selects command or return_message', (_, sql) => {
    const code = stripComments(sql);
    expect(code).not.toMatch(/\bcommand\b/i);
    expect(code).not.toMatch(/\breturn_message\b/i);
  });

  test.each([
    ['migration', migration],
    ['canonical file', canonical],
  ])('%s revokes from PUBLIC, anon, authenticated and grants only service_role', (_, sql) => {
    const code = stripComments(sql);
    expect(code).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_cron_health\s*\(\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i,
    );
    expect(code).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_cron_health\s*\(\s*\)\s+TO\s+service_role\s*;/i,
    );
    expect(code).not.toMatch(/GRANT[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i);
  });

  test('migration header explains the purpose and the grant review', () => {
    const header = migration.split('CREATE OR REPLACE')[0];
    expect(header).toContain('cron-watchdog');
    expect(header).toContain('Grant review');
  });

  test('canonical body equals the migration body (whitespace-normalized)', () => {
    expect(normalize(canonical)).toBe(normalize(migration));
  });
});
