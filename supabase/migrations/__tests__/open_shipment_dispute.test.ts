import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A dispute opens under the shipment row lock from the shipment's own state.
 * These tests read SQL text; `supabase db reset` plus bruno/dispute-integrity
 * prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
  f.endsWith('_open_shipment_dispute.sql'),
);
const migration =
  files.length === 1
    ? readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8').replace(/\r/g, '')
    : '';
const code = migration.replace(/--[^\n]*/g, '');

const canonical = readFileSync(
  join(QUERIES_DIR, 'disputes', 'fn_open_shipment_dispute.sql'),
  'utf8',
).replace(/\r/g, '');

const locksThenChecksThenInserts = (sql: string): void => {
  const lock = sql.search(/FROM public\.shipments AS s[\s\S]*?FOR UPDATE/);
  const order = [
    "'SHIPMENT_NOT_FOUND'",
    "'SHIPMENT_ORDER_MISMATCH'",
    "'ORDER_BUYER_MISMATCH'",
    "'DISPUTE_STATUS_NOT_ALLOWED:'",
    "'DISPUTE_WINDOW_EXPIRED'",
    "'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'",
    "'DISPUTE_ALREADY_EXISTS'",
  ].map((marker) => sql.indexOf(marker));
  const insert = sql.search(/INSERT INTO public\.disputes/);

  expect(lock).toBeGreaterThan(-1);
  expect(order[0]).toBeGreaterThan(lock);
  for (let i = 1; i < order.length; i++) {
    expect(order[i]).toBeGreaterThan(order[i - 1]);
  }
  expect(insert).toBeGreaterThan(order[order.length - 1]);
  expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'");
  expect(sql).toContain("v_status NOT IN ('shipped', 'delivered')");
  expect(sql).toContain('v_delivered_at < now() - interval \'48 hours\'');
  expect(sql).toContain('operation.external_started_at IS NOT NULL');
};

describe('open_shipment_dispute migration', () => {
  test('exactly one migration exists', () => {
    expect(files.length).toBe(1);
  });

  test('the function is a locked-down SECURITY DEFINER', () => {
    expect(code).toContain('SECURITY DEFINER');
    expect(code).toContain("SET search_path TO ''");
  });

  test('is executable by service_role only', () => {
    const signature =
      'public.fn_open_shipment_dispute(uuid, uuid, uuid, public.dispute_reason, text, jsonb)';
    expect(code).toContain(
      `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`,
    );
    expect(code).toContain(
      `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`,
    );
  });

  test('locks the shipment, then checks, then inserts', () => {
    locksThenChecksThenInserts(code);
  });

  test('the canonical copy carries the migration body', () => {
    const open = migration.indexOf('$$');
    const body = migration.slice(open + 2, migration.indexOf('$$;', open + 2));
    const collapse = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
    expect(collapse(canonical)).toBe(collapse(body));
    locksThenChecksThenInserts(canonical);
  });
});
