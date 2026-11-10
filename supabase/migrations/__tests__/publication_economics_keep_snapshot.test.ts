import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-contract guards for auth-hardening T10a.1 (#120). Static checks only: the runtime
 * proof is supabase/tests/database/publication_economics.test.sql and the Bruno sequence
 * `stale-economics`.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const body = (sql: string) =>
  normalize(sql.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1] ?? '');

const migration = read(
  'supabase/migrations/20261031120000_publication_economics_keep_snapshot.sql',
);

describe('publication economics keep the published snapshot', () => {
  test('the migration defines the function body', () => {
    expect(body(migration)).not.toBe('');
  });

  test('a price or shipping cost change is gated, and the status early return is gone', () => {
    const sql = body(migration);
    expect(sql).toContain('NEW.price IS NOT DISTINCT FROM OLD.price');
    expect(sql).toContain(
      'NEW.shipping_cost IS NOT DISTINCT FROM OLD.shipping_cost',
    );
    expect(sql).not.toContain('NEW.deleted_at IS NOT NULL');
    expect(sql).not.toContain("'HIDDEN'::public.product_status_enum");
  });

  test('every error code is kept', () => {
    const sql = body(migration);
    for (const code of [
      'PUBLICATION_ECONOMICS_IMMUTABLE',
      'PUBLICATION_SNAPSHOT_REQUIRED',
      'PUBLICATION_ECONOMICS_CONFIGURATION_REQUIRED',
      'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
    ]) {
      expect(sql).toContain(code);
    }
  });

  test('restates the service-only grants of the trigger function', () => {
    expect(normalize(migration)).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_product_publication_economics() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'",
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.validate_product_publication_economics() FROM PUBLIC, anon, authenticated;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.validate_product_publication_economics() TO service_role;',
    );
    expect(migration).not.toMatch(/DROP |CREATE (OR REPLACE )?TRIGGER/i);
  });
});
