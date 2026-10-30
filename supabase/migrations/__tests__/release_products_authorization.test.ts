import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the fn_release_products authorization fix.
 *
 * The deployed function was SECURITY DEFINER, granted to `authenticated`, and
 * rejected JWTs without `sub` (so the service role could not call it). The fix
 * makes it service_role only and SECURITY INVOKER. These tests read SQL text;
 * `supabase db reset` is what proves the SQL runs in PostgreSQL.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const CANONICAL_PATH = join(
  import.meta.dir,
  '..',
  '..',
  'queries',
  'products',
  'fn_release_products.sql',
);

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_release_products_service_role_only.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_release_products_service_role_only.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const normalize = (sql: string): string =>
  stripComments(sql).replace(/\s+/g, ' ').trim();

describe('fn_release_products authorization migration', () => {
  const migration = findMigration();
  const canonical = readFileSync(CANONICAL_PATH, 'utf8');

  test.each([
    ['migration', migration],
    ['canonical file', canonical],
  ])(
    '%s defines a SECURITY INVOKER function with the original signature',
    (_, sql) => {
      const code = stripComments(sql);
      expect(code).toMatch(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_release_products\s*\(\s*p_product_ids\s+UUID\[\]\s*\)/i,
      );
      expect(code).toMatch(/RETURNS\s+TABLE\s*\(\s*success\s+BOOLEAN\s*\)/i);
      expect(code).not.toMatch(/SECURITY\s+DEFINER/i);
      expect(code).toMatch(/SET\s+search_path\s*=\s*public,\s*pg_temp/i);
    },
  );

  test.each([
    ['migration', migration],
    ['canonical file', canonical],
  ])('%s has no session check', (_, sql) => {
    const code = stripComments(sql);
    expect(code).not.toContain('UNAUTHORIZED_NO_SESSION');
    expect(code).not.toContain('request.jwt.claims');
  });

  test('migration keeps the strict RESERVED -> VERIFIED guard', () => {
    const body = normalize(migration);
    expect(body).toContain("SET status = 'VERIFIED'");
    expect(body).toContain('reserved_at = NULL');
    expect(body).toContain("AND status = 'RESERVED'");
    expect(body).toContain('RETURN QUERY SELECT true');
  });

  // The account-hold migration (release_reservation_account_hold) replaced the
  // body, and release_listings_helper moved the release into fn_release_listings
  // (RESERVED rows only); their own tests pin the canonical text.
  test('canonical file releases RESERVED rows only, through the helper', () => {
    const body = normalize(canonical);
    expect(body).toContain(
      'PERFORM public.fn_release_listings(p_product_ids, true, false)',
    );
    expect(body).toContain('RETURN QUERY SELECT true');
  });

  test.each([
    ['migration', migration],
    ['canonical file', canonical],
  ])(
    '%s revokes from PUBLIC, anon, authenticated and grants only service_role',
    (_, sql) => {
      const code = stripComments(sql);
      expect(code).toMatch(
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_release_products\s*\(\s*UUID\[\]\s*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
      );
      expect(code).toMatch(
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_release_products\s*\(\s*UUID\[\]\s*\)\s+TO\s+service_role/i,
      );
      expect(code).not.toMatch(
        /GRANT[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i,
      );
    },
  );

  test('canonical header points at the new migration', () => {
    expect(canonical).toContain('release_products_service_role_only');
  });
});
