import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A Connect shipment is marked refunded only by resolve-dispute-refund, after
 * the Stripe refund: fn_seller_confirm_return_shipment is dropped and
 * fn_complete_shipment_refund refuses Connect shipments. These tests read SQL
 * text; `supabase db reset` plus bruno/dispute-integrity prove the SQL runs.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries');

const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
  f.endsWith('_connect_refund_requires_stripe.sql'),
);
const migration =
  files.length === 1
    ? readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8').replace(/\r/g, '')
    : '';
const code = migration.replace(/--[^\n]*/g, '');

const canonical = readFileSync(
  join(QUERIES_DIR, 'shipments', 'fn_complete_shipment_refund.sql'),
  'utf8',
).replace(/\r/g, '');

const refusesConnectBeforeAnyWrite = (sql: string): void => {
  const guard = sql.indexOf('stripe_payment_intent_id IS NOT NULL');
  const refusal = sql.indexOf("'CONNECT_REFUND_REQUIRES_STRIPE'");
  const firstUpdate = sql.search(/\bUPDATE public\./);
  expect(guard).toBeGreaterThan(-1);
  expect(refusal).toBeGreaterThan(guard);
  expect(firstUpdate).toBeGreaterThan(refusal);
  expect(sql).not.toContain('CONNECT_SHIPMENT_SKIPPED_WALLET_REFUND');
};

describe('connect_refund_requires_stripe migration', () => {
  test('exactly one migration exists', () => {
    expect(files.length).toBe(1);
  });

  test('drops the client-callable return confirmation', () => {
    expect(code).toContain(
      'DROP FUNCTION IF EXISTS public.fn_seller_confirm_return_shipment(uuid);',
    );
    expect(
      existsSync(join(QUERIES_DIR, 'shipments', 'fn_seller_confirm_return_shipment.sql')),
    ).toBe(false);
  });

  test('fn_complete_shipment_refund refuses Connect shipments before any write', () => {
    refusesConnectBeforeAnyWrite(code);
  });

  test('fn_complete_shipment_refund stays service-role only', () => {
    expect(code).toContain(
      'REVOKE ALL ON FUNCTION public.fn_complete_shipment_refund(uuid) FROM PUBLIC, anon, authenticated;',
    );
    expect(code).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_complete_shipment_refund(uuid) TO service_role;',
    );
  });

  test('the canonical copy carries the migration body', () => {
    const open = migration.indexOf('$$');
    const body = migration.slice(open + 2, migration.indexOf('$$;', open + 2));
    const collapse = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
    expect(collapse(canonical)).toBe(collapse(body));
    refusesConnectBeforeAnyWrite(canonical);
  });
});
