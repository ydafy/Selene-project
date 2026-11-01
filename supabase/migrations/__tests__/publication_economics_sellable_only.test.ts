import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-contract guards for auth-hardening T9f (#69). T10a.1 (#120) replaced the function
 * (see publication_economics_keep_snapshot.test.ts), so these pin only the historic
 * migration. Runtime proof: supabase/tests/database/publication_economics.test.sql and the
 * Bruno request `delete-account-stale-listing`.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const migration = read(
  'supabase/migrations/20261030140000_publication_economics_sellable_only.sql',
);

describe('publication economics only guard sellable listings (historic T9f migration)', () => {
  test('an UPDATE that leaves the listing non-sellable returns before the economics check', () => {
    const sql = normalize(migration);
    const early = sql.indexOf(
      "NEW.deleted_at IS NOT NULL OR NEW.status IN ( 'HIDDEN'::public.product_status_enum, 'SOLD'::public.product_status_enum, 'REJECTED'::public.product_status_enum, 'IN_DISPUTE'::public.product_status_enum ) ) THEN RETURN NEW;",
    );
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeGreaterThan(
      sql.indexOf('PUBLICATION_ECONOMICS_IMMUTABLE'),
    );
    expect(early).toBeLessThan(
      sql.lastIndexOf('INVALID_OR_STALE_PUBLICATION_ECONOMICS'),
    );
  });

  test('keeps the trigger function security attributes and restates service-only grants', () => {
    expect(normalize(migration)).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_product_publication_economics() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'",
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.validate_product_publication_economics() FROM PUBLIC, anon, authenticated;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.validate_product_publication_economics() TO service_role;',
    );
    expect(migration).toContain('Grant review');
    expect(migration).not.toMatch(/DROP |CREATE (OR REPLACE )?TRIGGER/i);
  });
});
