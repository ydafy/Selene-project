import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Client roles keep only SELECT on public.shipments; every write goes through Edge
 * Functions and RPCs. These tests read SQL text; `supabase db reset` plus the
 * order-A-shipment-* requests in bruno/orders prove the privileges per role.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_shipments_server_only_writes.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_shipments_server_only_writes.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8').replace(/\r/g, '');
};

const sql = findMigration()
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

describe('shipments server-only writes', () => {
  test('drops both client UPDATE policies', () => {
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "shipments_update_seller" ON public.shipments;',
    );
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "shipments_update_admin" ON public.shipments;',
    );
  });

  test('revokes every write privilege from the client roles and keeps SELECT', () => {
    expect(sql).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.shipments FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).not.toMatch(/REVOKE[^;]*SELECT[^;]*shipments/i);
    expect(sql).not.toMatch(/REVOKE ALL/i);
  });

  test('grants nothing back', () => {
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });
});
