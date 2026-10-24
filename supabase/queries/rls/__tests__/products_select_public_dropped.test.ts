import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for dropping the public products policy (T4d3). These tests
 * read SQL text; `supabase db reset` plus the Bruno requests in bruno/products
 * prove that a non-owner reads no table row and the owner and admin still do.
 */

const QUERIES_DIR = join(import.meta.dir, '..', '..');
const MIGRATIONS_DIR = join(QUERIES_DIR, '..', 'migrations');

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const findMigration = (): { raw: string; sql: string } => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_drop_products_select_public.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_drop_products_select_public.sql, found ${files.length}`,
    );
  }
  const raw = readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
  return { raw, sql: normalize(raw) };
};

describe('drop products_select_public', () => {
  const { raw, sql } = findMigration();

  test('drops the public policy by exact name', () => {
    expect(sql).toContain(
      'DROP POLICY IF EXISTS products_select_public ON public.products;',
    );
  });

  test('does not create or alter any policy', () => {
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/ALTER POLICY/i);
  });

  test('leaves the owner and admin policies alone', () => {
    expect(sql).not.toContain('products_select_owner');
    expect(sql).not.toContain('products_select_admin');
  });

  test('explains why and the deploy order in the header', () => {
    const header = raw.slice(0, raw.indexOf('DROP POLICY'));
    expect(header).toContain('products_public');
    expect(header).toMatch(/deploy order/i);
  });

  test('moves get_profile_stats to the public view', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.get_profile_stats',
    );
    expect(sql).toMatch(/from public\.products_public where seller_id/i);
    expect(sql).not.toMatch(/from public\.products where/i);
  });

  test('keeps the get_profile_stats grants explicit', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_profile_stats(uuid) FROM PUBLIC;',
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_profile_stats\(uuid\) TO anon, authenticated, service_role;/,
    );
  });
});

describe('canonical files', () => {
  const policyFile = readFileSync(
    join(QUERIES_DIR, 'rls', 'products_select_public.sql'),
    'utf8',
  );

  test('products_select_public.sql states the policy was dropped', () => {
    expect(policyFile).toMatch(/dropped/i);
    expect(policyFile).toContain('products_public');
    expect(normalize(policyFile)).toBe('');
  });

  test('get_profile_stats.sql reads the public view', () => {
    const sql = normalize(
      readFileSync(join(QUERIES_DIR, 'profile', 'get_profile_stats.sql'), 'utf8'),
    );
    expect(sql).toMatch(/from public\.products_public where seller_id/i);
    expect(sql).not.toMatch(/from public\.products where/i);
  });
});
