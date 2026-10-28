import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A project rebuilt from migrations must grant the same EXECUTE privileges as the
 * deployed one. These tests read SQL text; `supabase db reset` plus the
 * rpc-fn-*-denied requests in bruno/auth prove the privileges per role.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_function_execute_grants_parity.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_function_execute_grants_parity.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8').replace(/\r/g, '');
};

const sql = findMigration()
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

describe('function execute grants parity', () => {
  test('revokes client EXECUTE on the payment and payout projection functions', () => {
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_create_shipments_from_single_payment(text,text,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_project_payout_run_terminal(uuid,text,text,timestamp with time zone,text) FROM PUBLIC, anon, authenticated;',
    );
  });

  test('keeps the authenticated grant on functions the deployed project exposes to it', () => {
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.fn_lock_product(uuid) FROM PUBLIC, anon;',
    );
  });

  test('grants nothing', () => {
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });
});
