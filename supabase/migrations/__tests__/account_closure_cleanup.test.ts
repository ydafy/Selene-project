import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the account-closure cleanup retry (auth-hardening S8, T5c):
 * the atomic claim and attempt-count RPCs behind the account-closure-cleanup
 * worker and delete-account. These tests read SQL text; `supabase db reset`
 * plus the Bruno requests in bruno/functions prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries', 'auth');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_account_closure_cleanup.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_account_closure_cleanup.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const definition = (sql: string, name: string): string => {
  const match = normalize(sql).match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}.*?\\$\\$ ?;`,
      'i',
    ),
  );
  if (!match) throw new Error(`${name} definition not found`);
  return match[0];
};

describe('account closure cleanup migration', () => {
  const migration = findMigration();
  const canonical = readFileSync(
    join(QUERIES_DIR, 'account_closure_cleanup.sql'),
    'utf8',
  );
  const sql = normalize(migration);
  const claim = definition(migration, 'fn_claim_account_closures');
  const record = definition(migration, 'fn_record_closure_attempt');

  test('the migration and the canonical file define the same functions', () => {
    expect(definition(canonical, 'fn_claim_account_closures')).toBe(claim);
    expect(definition(canonical, 'fn_record_closure_attempt')).toBe(record);
  });

  test('both functions are service-role only with an empty search_path', () => {
    for (const fn of [claim, record]) {
      expect(fn).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
      expect(fn).toContain("RAISE EXCEPTION 'UNAUTHORIZED'");
      expect(fn).toMatch(/SET search_path = ''/i);
      expect(fn).not.toMatch(/SECURITY DEFINER/i);
    }
    for (const signature of [
      'fn_claim_account_closures\\(integer, interval, integer\\)',
      'fn_record_closure_attempt\\(uuid, text, boolean\\)',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM PUBLIC, anon, authenticated`,
          'i',
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role`,
          'i',
        ),
      );
      expect(sql).not.toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${signature} TO (anon|authenticated|PUBLIC)`,
          'i',
        ),
      );
    }
    expect(migration).toMatch(/--[^\n]*service role/i);
    expect(migration).toMatch(/--[^\n]*SECURITY INVOKER/i);
  });

  test('the claim bumps attempts and updated_at in the same statement that selects the rows', () => {
    expect(claim).toMatch(/RETURNS SETOF public\.account_closures/i);
    expect(claim).toMatch(/UPDATE public\.account_closures/i);
    expect(claim).toMatch(/attempts = \w+\.attempts \+ 1/i);
    expect(claim).toMatch(/updated_at = now\(\)/i);
    expect(claim).toMatch(/RETURNING/i);
    // Row locks that skip rows another run holds: no double claim.
    expect(claim).toMatch(/FOR UPDATE SKIP LOCKED/i);
  });

  test('the claim takes only open, idle, uncapped rows, oldest first, in a bounded batch', () => {
    for (const column of [
      'stripe_customer_cleanup',
      'stripe_account_cleanup',
      'storage_cleanup',
    ]) {
      expect(claim).toMatch(
        new RegExp(`${column} IN \\('pending', 'failed'\\)`),
      );
    }
    expect(claim).toMatch(/attempts < p_max_attempts/i);
    expect(claim).toMatch(/updated_at <= now\(\) - p_min_idle/i);
    expect(claim).toMatch(/ORDER BY \w+\.updated_at, \w+\.user_id/i);
    expect(claim).toMatch(/LIMIT p_limit/i);
  });

  test('the claim rejects unusable arguments before touching data', () => {
    expect(claim).toContain("RAISE EXCEPTION 'INVALID_ARGUMENT'");
    expect(claim.indexOf('INVALID_ARGUMENT')).toBeLessThan(
      claim.indexOf('UPDATE public.account_closures'),
    );
    expect(claim).toMatch(/p_limit > 100/);
  });

  test('recording an attempt is one UPDATE that increments in the database', () => {
    expect(record).toMatch(/RETURNS void/i);
    expect(record).toMatch(/UPDATE public\.account_closures/i);
    expect(record).toMatch(
      /attempts = (\w+\.)?attempts \+ CASE WHEN p_count_attempt THEN 1 ELSE 0 END/i,
    );
    expect(record).toMatch(/last_error = left\(p_last_error, \d+\)/i);
    expect(record).toMatch(/updated_at = now\(\)/i);
    expect(record).toMatch(/WHERE user_id = p_user_id/i);
  });

  test('adds no table, policy or client grant', () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/GRANT [^;]* TO [^;]*\b(anon|authenticated|PUBLIC)\b/);
  });
});
