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

/** Every migration that (re)defines fn_cron_health, oldest first. */
const findMigrations = (): Array<[string, string]> => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f): [string, string] => [f, readFileSync(join(MIGRATIONS_DIR, f), 'utf8')])
    .filter(([, sql]) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_cron_health\s*\(/i.test(sql));
  if (files.length === 0) throw new Error('No migration defines public.fn_cron_health');
  return files;
};

const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const normalize = (sql: string): string => stripComments(sql).replace(/\s+/g, ' ').trim();

describe('fn_cron_health migration', () => {
  const migrations = findMigrations();
  const migration = migrations[migrations.length - 1][1];
  const canonical = readFileSync(CANONICAL_PATH, 'utf8');
  const sources: Array<[string, string]> = [...migrations, ['canonical file', canonical]];

  test('the original migration and the BL33 primary-key rewrite both define it', () => {
    expect(migrations.map(([file]) => file)).toEqual([
      '20261021025844_cron_health.sql',
      '20261026014010_cron_health_index_scan.sql',
    ]);
  });

  test.each(sources)('%s defines a SECURITY DEFINER function with a pinned search_path', (_, sql) => {
    const code = stripComments(sql);
    expect(code).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_cron_health\s*\(\s*\)/i);
    expect(code).toMatch(/SECURITY\s+DEFINER/i);
    expect(code).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*pg_temp/i);
  });

  test.each(sources)('%s returns exactly jobname, schedule, active, last_start, last_status', (_, sql) => {
    const returns = normalize(sql).match(/RETURNS TABLE\s*\((.*?)\) LANGUAGE/i);
    expect(returns).not.toBeNull();
    const columns = returns![1].split(',').map((c) => c.trim().split(' ')[0]);
    expect(columns).toEqual(['jobname', 'schedule', 'active', 'last_start', 'last_status']);
  });

  test.each(sources)('%s never selects command or return_message', (_, sql) => {
    const code = stripComments(sql);
    expect(code).not.toMatch(/\bcommand\b/i);
    expect(code).not.toMatch(/\breturn_message\b/i);
  });

  test.each(sources)('%s revokes from PUBLIC, anon, authenticated and grants only service_role', (_, sql) => {
    const code = stripComments(sql);
    expect(code).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_cron_health\s*\(\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i,
    );
    expect(code).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_cron_health\s*\(\s*\)\s+TO\s+service_role\s*;/i,
    );
    expect(code).not.toMatch(/GRANT[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i);
  });

  test.each(migrations)('%s header explains the purpose and the grant review', (_, sql) => {
    const header = sql.split('CREATE OR REPLACE')[0];
    expect(header).toContain('cron-watchdog');
    expect(header).toContain('Grant review');
  });

  test('the latest definition reads the newest started run by primary key, not a per-job full sort', () => {
    const code = normalize(migration);
    expect(code).toContain('WHERE r.jobid = j.jobid AND r.start_time IS NOT NULL ORDER BY r.runid DESC LIMIT 1');
    expect(code).not.toContain('ORDER BY r.start_time DESC');
  });

  test('canonical body equals the latest migration body (whitespace-normalized)', () => {
    expect(normalize(canonical)).toBe(normalize(migration));
  });
});
