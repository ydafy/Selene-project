import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A dispute refund is recorded under the shipment row lock after the Stripe
 * refund. These tests read SQL text; `supabase db reset` plus
 * bruno/dispute-integrity prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
  f.endsWith('_record_dispute_refund.sql'),
);
const migration =
  files.length === 1
    ? readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8').replace(/\r/g, '')
    : '';
const code = migration.replace(/--[^\n]*/g, '');

const canonical = readFileSync(
  join(QUERIES_DIR, 'disputes', 'fn_record_dispute_refund.sql'),
  'utf8',
).replace(/\r/g, '');

const locksThenChecksThenWrites = (sql: string): void => {
  const lock = sql.search(/FROM public\.shipments AS s[\s\S]*?FOR UPDATE/);
  const order = [
    "'DISPUTE_NOT_FOUND'",
    "'SHIPMENT_NOT_FOUND'",
    "'SHIPMENT_NOT_CONNECT'",
    "'ALREADY_RECORDED'",
    "'INVALID_DISPUTE_STATUS'",
    "'SHIPMENT_NOT_REFUNDABLE:'",
  ].map((marker) => sql.indexOf(marker));
  const shipmentWrite = sql.search(/UPDATE public\.shipments/);
  const disputeWrite = sql.search(/UPDATE public\.disputes/);

  expect(lock).toBeGreaterThan(-1);
  expect(order[1]).toBeGreaterThan(lock);
  for (let i = 1; i < order.length; i++) {
    expect(order[i]).toBeGreaterThan(order[i - 1]);
  }
  expect(shipmentWrite).toBeGreaterThan(order[order.length - 1]);
  expect(disputeWrite).toBeGreaterThan(shipmentWrite);
  expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'");
  expect(sql).toContain("v_shipment_status NOT IN ('shipped', 'delivered')");
  expect(sql).toContain(
    "v_dispute_status NOT IN ('waiting_return', 'return_delivered')",
  );
  expect(sql).toContain("resolution_type = 'buyer'");
  expect(sql).toContain("COALESCE(p_stripe_refund_id, 'unknown')");
  expect(sql).toContain('INSERT INTO public.system_logs');
};

describe('record_dispute_refund migration', () => {
  test('exactly one migration exists', () => {
    expect(files.length).toBe(1);
  });

  test('the function is a locked-down SECURITY DEFINER', () => {
    expect(code).toContain('SECURITY DEFINER');
    expect(code).toContain("SET search_path TO ''");
  });

  test('is executable by service_role only', () => {
    const signature = 'public.fn_record_dispute_refund(uuid, text)';
    expect(code).toContain(
      `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`,
    );
    expect(code).toContain(
      `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`,
    );
  });

  test('locks the shipment, then checks, then writes', () => {
    locksThenChecksThenWrites(code);
  });

  test('the canonical copy carries the migration body', () => {
    const open = migration.indexOf('$$');
    const body = migration.slice(open + 2, migration.indexOf('$$;', open + 2));
    const collapse = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
    expect(collapse(canonical)).toBe(collapse(body));
    locksThenChecksThenWrites(canonical);
  });
});
