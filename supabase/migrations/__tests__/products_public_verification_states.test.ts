import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for the public products policy. These tests read SQL text;
 * `supabase db reset` plus the Bruno requests in bruno/products prove the
 * policy runs and what anon sees.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_products_public_verification_states.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_products_public_verification_states.sql, found ${files.length}`,
    );
  }
  return normalize(readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8'));
};

const canonical = normalize(
  readFileSync(join(QUERIES_DIR, 'rls', 'products_select_public.sql'), 'utf8'),
);

describe('products_select_public', () => {
  const sql = findMigration();

  test('replaces the policy by exact name', () => {
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "products_select_public" ON public.products;',
    );
    expect(sql).toContain(
      'CREATE POLICY "products_select_public" ON public.products FOR SELECT',
    );
  });

  test('is a SELECT policy without a role clause (same roles as before)', () => {
    expect(sql).not.toMatch(/CREATE POLICY[^;]*\sTO\s/i);
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/i);
  });

  test('shows live listings in exactly the four public states', () => {
    expect(sql).toContain(
      "USING ( deleted_at IS NULL AND status IN ('VERIFIED', 'SOLD', 'PENDING_VERIFICATION', 'IN_REVIEW') )",
    );
  });

  test('never lists the hidden states in the policy', () => {
    const create = sql.slice(sql.indexOf('CREATE POLICY'));
    for (const hidden of ['REJECTED', 'HIDDEN', 'RESERVED', 'IN_DISPUTE']) {
      expect(create).not.toContain(hidden);
    }
  });

  test('migration contains the canonical policy', () => {
    expect(sql).toContain(canonical);
  });
});
