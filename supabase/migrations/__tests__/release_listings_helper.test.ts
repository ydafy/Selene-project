import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for T9e2 (#70 class): every path that returns a listing to the
 * catalog goes through public.fn_release_listings, which decides from the
 * seller's current account status. These tests read SQL text; `supabase db
 * reset` plus the role-based runtime check is what proves the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const migration = (() => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_release_listings_helper.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected one *_release_listings_helper.sql, found ${files.length}`,
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
      String.raw`CREATE OR REPLACE FUNCTION public\.${name}\(.*?\$\$ ?;`,
      'i',
    ),
  );
  if (!match) throw new Error(`${name} definition not found`);
  return match[0];
};

const callers = [
  'fn_release_stale_reservations',
  'fn_release_products',
  'fn_reserve_products',
  'fn_finalize_checkout_recovery',
  'fn_cancel_shipment',
] as const;

describe('fn_release_listings helper', () => {
  test.each([['migration', migration]])(
    '%s applies the seller account rule under a seller lock',
    (_, sql) => {
      const body = functionStatement(sql, 'fn_release_listings');
      expect(body).toContain(
        'fn_release_listings( p_product_ids UUID[], p_only_reserved BOOLEAN, p_only_expired BOOLEAN ) RETURNS SETOF UUID',
      );
      expect(body).not.toMatch(/SECURITY DEFINER/i);
      expect(body).toMatch(/SET search_path = public, pg_temp/i);
      expect(body).toMatch(/ORDER BY pp\.id FOR SHARE/i);
      expect(body).toMatch(/COALESCE\(pp\.status, 'active'\) = 'active'/i);
      expect(body).toContain("'HIDDEN'::public.product_status_enum");
      expect(body).toMatch(
        /COALESCE\(p\.status_before_account_hold, 'VERIFIED'::public\.product_status_enum\)/i,
      );
      expect(body).toMatch(/NOT p_only_reserved OR p\.status = 'RESERVED'/i);
      expect(body).toMatch(/NOT p_only_expired OR p\.reserved_at < now\(\)/i);
    },
  );
});

describe.each(callers)('%s uses the helper', (name) => {
  test('the migration body calls fn_release_listings', () => {
    expect(functionStatement(migration, name)).toContain(
      'public.fn_release_listings(',
    );
  });
});

describe('caller row filters', () => {
  const body = (name: string) => functionStatement(migration, name);

  test('stale release keeps its TTL and optional id scope', () => {
    expect(body('fn_release_stale_reservations')).toMatch(
      /fn_release_listings\(v_ids, true, true\)/,
    );
  });

  test('checkout failure release and refund compensation touch RESERVED rows only', () => {
    expect(body('fn_release_products')).toMatch(
      /fn_release_listings\(p_product_ids, true, false\)/,
    );
    expect(body('fn_finalize_checkout_recovery')).toMatch(
      /fn_release_listings\( ARRAY\(.*oi\.order_id = v_order_id\), true, false \)/,
    );
  });

  test('callers keep service_role only grants', () => {
    const code = normalize(migration);
    for (const [name, args] of [
      ['fn_release_stale_reservations', 'UUID[]'],
      ['fn_release_products', 'UUID[]'],
      ['fn_reserve_products', 'UUID, UUID[]'],
      ['fn_finalize_checkout_recovery', 'TEXT, TEXT'],
      ['fn_cancel_shipment', 'UUID, TEXT, TEXT, BIGINT'],
    ]) {
      expect(code).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated;`,
      );
      expect(code).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`,
      );
    }
  });
});
