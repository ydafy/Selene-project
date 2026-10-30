import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-contract guards for auth-hardening T9f (#69). Static checks only: the runtime
 * proof (closure, suspension, publish and re-price rejection) is the local-stack run and
 * the Bruno request `delete-account-stale-listing`.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const migration = read(
  'supabase/migrations/20261030140000_publication_economics_sellable_only.sql',
);
const canonical = read(
  'supabase/queries/triggers/product/validate_product_publication_economics.sql',
);
const body = (sql: string) =>
  normalize(sql.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1] ?? '');

describe('publication economics only guard sellable listings', () => {
  test('the migration function body matches the canonical file', () => {
    expect(body(migration)).not.toBe('');
    expect(body(migration)).toBe(body(canonical));
  });

  test('an UPDATE that leaves the listing non-sellable returns before the economics check', () => {
    const sql = body(canonical);
    const early = sql.indexOf(
      "NEW.deleted_at IS NOT NULL OR NEW.status IN ( 'HIDDEN'::public.product_status_enum, 'SOLD'::public.product_status_enum, 'REJECTED'::public.product_status_enum, 'IN_DISPUTE'::public.product_status_enum ) ) THEN RETURN NEW;",
    );
    expect(early).toBeGreaterThan(-1);
    expect(
      sql.indexOf("TG_OP = 'UPDATE' AND ( NEW.deleted_at"),
    ).toBeGreaterThan(-1);
    expect(early).toBeGreaterThan(
      sql.indexOf('PUBLICATION_ECONOMICS_IMMUTABLE'),
    );
    expect(early).toBeLessThan(
      sql.indexOf('INVALID_OR_STALE_PUBLICATION_ECONOMICS'),
    );
    expect(early).toBeLessThan(sql.indexOf('PUBLICATION_SNAPSHOT_REQUIRED'));
  });

  test('sellable statuses are never in the skip list and every error code is kept', () => {
    const sql = body(canonical);
    const skip = sql.slice(
      sql.indexOf('NEW.deleted_at'),
      sql.indexOf('RETURN NEW;'),
    );
    for (const status of [
      'VERIFIED',
      'RESERVED',
      'PENDING_VERIFICATION',
      'IN_REVIEW',
    ]) {
      expect(skip).not.toContain(status);
    }
    for (const code of [
      'PUBLICATION_ECONOMICS_IMMUTABLE',
      'PUBLICATION_SNAPSHOT_REQUIRED',
      'PUBLICATION_ECONOMICS_CONFIGURATION_REQUIRED',
      'INVALID_OR_STALE_PUBLICATION_ECONOMICS',
    ]) {
      expect(sql).toContain(code);
    }
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
