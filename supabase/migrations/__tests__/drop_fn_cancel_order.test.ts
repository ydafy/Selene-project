import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for issue #39 (B5.7): the legacy fn_cancel_order is dropped by one
 * migration, no later migration recreates it, and its canonical file is gone.
 * These tests read SQL text; `supabase db reset` proves the migration runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(MIGRATIONS_DIR, '..', 'queries');

const all = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const dropFiles = all.filter((f) => f.endsWith('_drop_fn_cancel_order.sql'));
const dropName = dropFiles[0] ?? '';
const migration = dropName ? readFileSync(join(MIGRATIONS_DIR, dropName), 'utf8').replace(/\r\n/g, '\n') : '';
const code = migration.replace(/^\s*--.*$/gm, '');

describe('drop_fn_cancel_order migration', () => {
  test('exists exactly once and runs in one transaction', () => {
    expect(dropFiles).toHaveLength(1);
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.trimEnd()).toEndWith('COMMIT;');
  });

  test('drops the exact signature, idempotently and without CASCADE', () => {
    expect(code).toContain('DROP FUNCTION IF EXISTS public.fn_cancel_order(uuid, text, text);');
    expect(code).not.toMatch(/CASCADE/i);
  });

  test('does not touch fn_cancel_shipment', () => {
    expect(code).not.toMatch(/fn_cancel_shipment/);
  });

  test('is newer than the migration that last defined the function', () => {
    const definers = all.filter((f) =>
      /CREATE (OR REPLACE )?FUNCTION public\.fn_cancel_order\(/.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')),
    );
    expect(definers.length).toBeGreaterThan(0);
    for (const definer of definers) expect(definer < dropName).toBe(true);
  });

  test('no later migration recreates it', () => {
    expect(dropName).not.toBe('');
    for (const file of all.filter((f) => f > dropName)) {
      expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')).not.toMatch(
        /CREATE (OR REPLACE )?FUNCTION public\.fn_cancel_order\b/,
      );
    }
  });

  test('the canonical query file is removed', () => {
    expect(existsSync(join(QUERIES_DIR, 'orders', 'fn_cancel_order.sql'))).toBe(false);
  });
});
