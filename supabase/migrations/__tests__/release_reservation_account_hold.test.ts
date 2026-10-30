import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for #70: a reservation that ends for a seller whose account is
 * not active is held (HIDDEN + status_before_account_hold), not re-listed.
 * These tests read SQL text; `supabase db reset` plus the role-based runtime
 * check is what proves the SQL runs in PostgreSQL.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const migration = (() => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_release_reservation_account_hold.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected one *_release_reservation_account_hold.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
})();

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const functionStatement = (sql: string, name: string): string => {
  const match = normalize(sql).match(
    new RegExp(
      String.raw`CREATE OR REPLACE FUNCTION public\.${name}\b.*?\$\$ ?;`,
      'i',
    ),
  );
  if (!match) throw new Error(`${name} definition not found`);
  return match[0];
};

describe.each(['fn_release_stale_reservations', 'fn_release_products'])(
  '%s account hold',
  (name) => {
    // This migration was superseded by release_listings_helper, which moved the
    // rule into fn_release_listings and rewrote the canonical files; the helper
    // test pins the canonical text. These checks pin the migration as deployed.
    test('migration holds the listing of a non-active seller instead of re-listing it', () => {
      const body = functionStatement(migration, name);
      expect(body).toMatch(/COALESCE\(.*status, 'active'\) = 'active'/i);
      expect(body).toContain("'HIDDEN'::public.product_status_enum");
      expect(body).toMatch(/status_before_account_hold = CASE/i);
      expect(body).toMatch(
        /COALESCE\((p\.)?status_before_account_hold, 'VERIFIED'/i,
      );
      expect(body).toMatch(/FOR SHARE/i);
      expect(body).toMatch(/AND p\.status = 'RESERVED'/i);
    });

    test('migration keeps service_role only grants', () => {
      const code = normalize(migration);
      expect(code).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${name}(UUID[]) FROM PUBLIC, anon, authenticated;`,
      );
      expect(code).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}(UUID[]) TO service_role;`,
      );
    });
  },
);
