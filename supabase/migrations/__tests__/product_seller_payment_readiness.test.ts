import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for fn_product_seller_payment_readiness, the read-only check
 * the app uses to tell buyers whether a listing's seller can receive payments
 * before checkout. These tests read SQL text; `supabase db reset` plus the
 * Bruno requests in bruno/products prove the SQL runs and its grants.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_product_seller_payment_readiness.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_product_seller_payment_readiness.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('fn_product_seller_payment_readiness', () => {
  const migration = findMigration();

  test('the migration defines the function', () => {
    const definition = (sql: string) =>
      normalize(sql).match(
        /CREATE OR REPLACE FUNCTION public\.fn_product_seller_payment_readiness.*?\$\$ ?;/i,
      )?.[0];
    expect(definition(migration)).toBeDefined();
  });

  test.each([['migration', migration]])(
    '%s is a read-only definer function with a pinned search_path',
    (_, sql) => {
      const code = normalize(sql);
      expect(code).toMatch(
        /FUNCTION public\.fn_product_seller_payment_readiness\( ?p_product_ids UUID\[\] ?\) RETURNS TABLE ?\( ?product_id UUID, seller_accepts_payments BOOLEAN ?\)/i,
      );
      expect(code).toMatch(/\bSTABLE\b/);
      expect(code).toMatch(/SECURITY DEFINER/);
      expect(code).toMatch(/SET search_path = public, pg_temp/);
      expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    },
  );

  test.each([['migration', migration]])(
    '%s applies the same seller rules as checkout',
    (_, sql) => {
      const code = normalize(sql);
      expect(code).toContain('pp.stripe_account_id IS NOT NULL');
      expect(code).toContain("pp.stripe_onboarding_status = 'complete'");
      // profiles_private.status is nullable; NULL must not block, matching
      // fn_reserve_products (NOT EXISTS ... status IN ('suspended', 'banned')).
      expect(code).toContain("pp.status IS DISTINCT FROM 'suspended'");
      expect(code).toContain("pp.status IS DISTINCT FROM 'banned'");
      expect(code).not.toMatch(/pp\.status NOT IN/);
    },
  );

  test.each([['migration', migration]])(
    '%s only answers for live VERIFIED listings and caps the input',
    (_, sql) => {
      const code = normalize(sql);
      expect(code).toContain("p.status = 'VERIFIED'");
      expect(code).toContain('p.deleted_at IS NULL');
      expect(code).toContain('p_product_ids[1:50]');
    },
  );

  test('revokes PUBLIC and grants only the API roles that browse listings', () => {
    const code = normalize(migration);
    expect(code).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_product_seller_payment_readiness(UUID[]) FROM PUBLIC;',
    );
    expect(code).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_product_seller_payment_readiness(UUID[]) TO anon, authenticated, service_role;',
    );
  });
});
