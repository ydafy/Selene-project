import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * admin-web releases a product review lock with the admin's session (#66).
 * These tests read SQL text; `supabase db reset` plus the unlock-product-*
 * requests in bruno/products prove the privileges per role.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_unlock_product_authenticated_grant.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_unlock_product_authenticated_grant.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8').replace(/\r/g, '');
};

const sql = findMigration()
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

describe('fn_unlock_product authenticated grant', () => {
  test('grants EXECUTE to signed-in callers only', () => {
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_unlock_product(uuid) TO authenticated;',
    );
    expect(sql).not.toMatch(/GRANT[^;]*\b(anon|PUBLIC)\b/);
  });

  test('keeps anonymous callers out', () => {
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_unlock_product(uuid) FROM PUBLIC, anon;',
    );
  });

  test('checks admin through is_admin(), which refuses suspended and banned admins', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_unlock_product(p_product_id uuid)');
    expect(sql).toContain('IF NOT public.is_admin() THEN');
    expect(sql).not.toContain('profiles_private');
    expect(sql).toContain("RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION'");
  });

  test('touches fn_unlock_product only and keeps the function owner-safe', () => {
    expect(sql).not.toMatch(/ALTER FUNCTION|DROP |DELETE FROM|INSERT INTO public\.(?!admin_audit_logs)/i);
    const functions = sql.match(/FUNCTION public\.\w+/g) ?? [];
    expect(new Set(functions)).toEqual(new Set(['FUNCTION public.fn_unlock_product']));
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toMatch(/SET search_path TO 'public', 'pg_temp'/);
  });

  test('no later migration regrants or redefines fn_unlock_product', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const own = files.findIndex((f) => f.endsWith('_unlock_product_authenticated_grant.sql'));
    for (const f of files.slice(own + 1)) {
      expect(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).not.toMatch(/fn_unlock_product/);
    }
  });
});
