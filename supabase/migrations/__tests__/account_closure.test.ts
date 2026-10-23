import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guards for "anonymize and close" account deletion (auth-hardening S8):
 * the account_closures table and the service-only fn_close_account RPC. These
 * tests read SQL text; `supabase db reset` plus the Bruno requests in
 * bruno/auth prove the SQL runs and its grants.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_DIR = join(import.meta.dir, '..', '..', 'queries', 'auth');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith('_account_closure.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_account_closure.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const functionBody = (sql: string): string => {
  const match = normalize(sql).match(
    /CREATE OR REPLACE FUNCTION public\.fn_close_account.*?\$\$ ?;/i,
  );
  if (!match) throw new Error('fn_close_account definition not found');
  return match[0];
};

describe('account closure migration', () => {
  const migration = findMigration();
  const canonicalFunction = readFileSync(
    join(QUERIES_DIR, 'fn_close_account.sql'),
    'utf8',
  );
  const canonicalTable = readFileSync(
    join(QUERIES_DIR, 'account_closures.sql'),
    'utf8',
  );
  const sql = normalize(migration);
  const fn = functionBody(migration);

  test('the migration and the canonical files define the same function and table', () => {
    expect(functionBody(canonicalFunction)).toBe(fn);
    const table = (text: string) =>
      normalize(text).match(
        /CREATE TABLE IF NOT EXISTS public\.account_closures.*?\) ?;/i,
      )?.[0];
    expect(table(migration)).toBeDefined();
    expect(table(canonicalTable)).toBe(table(migration));
  });

  test('account_closures keeps one row per user with RLS on and no client access', () => {
    expect(sql).toMatch(
      /user_id uuid PRIMARY KEY REFERENCES auth\.users ?\(id\)/i,
    );
    for (const column of [
      'closed_at',
      'stripe_customer_id',
      'stripe_account_id',
      'stripe_customer_cleanup',
      'stripe_account_cleanup',
      'storage_cleanup',
      'attempts',
      'last_error',
      'updated_at',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toMatch(/'pending', 'done', 'failed', 'not_needed'/);
    expect(sql).toMatch(
      /ALTER TABLE public\.account_closures ENABLE ROW LEVEL SECURITY/i,
    );
    expect(sql).not.toMatch(/CREATE POLICY[^;]*account_closures/i);
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.account_closures FROM PUBLIC, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.account_closures FROM service_role/i,
    );
    expect(sql).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.account_closures TO service_role/i,
    );
  });

  test('profiles gets a deleted_at marker', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz/i,
    );
  });

  test('fn_close_account is SECURITY DEFINER with an empty search_path', () => {
    expect(fn).toMatch(/RETURNS jsonb/i);
    expect(fn).toMatch(/SECURITY DEFINER/i);
    expect(fn).toMatch(/SET search_path = ''/i);
    expect(fn).not.toMatch(/search_path = public/i);
  });

  test('EXECUTE is revoked from PUBLIC, anon and authenticated and granted to service_role only', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_close_account\(uuid\) FROM PUBLIC, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_close_account\(uuid\) TO service_role/i,
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_close_account\(uuid\) TO (anon|authenticated|PUBLIC)/i,
    );
    expect(migration).toMatch(/--[^\n]*service role/i);
  });

  test('locks the profile, handles unknown and already closed users, and refuses restricted accounts', () => {
    expect(fn).toMatch(/FROM public\.profiles_private[^;]*FOR UPDATE/i);
    expect(fn).toContain("'not_found'");
    expect(fn).toContain("'already_closed'");
    expect(fn).toContain("'account_restricted'");
    expect(fn).toMatch(/IN \('suspended', 'banned'\)/);
    // The closure lookup comes before the status check so a retry stays idempotent.
    expect(fn.indexOf("'already_closed'")).toBeLessThan(
      fn.indexOf("'account_restricted'"),
    );
  });

  test('locks the products and refuses with a blocker code before any write', () => {
    // Same lock order as fn_reserve_products, so a concurrent cart cannot deadlock.
    expect(fn).toMatch(
      /FROM public\.products WHERE seller_id = p_user_id ORDER BY id FOR UPDATE/i,
    );
    for (const code of [
      'active_shipments',
      'active_orders',
      'open_disputes',
      'pending_payouts',
      'pending_refunds',
    ]) {
      expect(fn).toContain(`'${code}'`);
    }
    const firstWrite = fn.search(/\b(UPDATE|DELETE FROM|INSERT INTO) /i);
    expect(fn.lastIndexOf("'pending_refunds'", firstWrite)).toBeGreaterThan(0);
    expect(fn.lastIndexOf("'active_orders'", firstWrite)).toBeGreaterThan(0);
  });

  test('blockers use the real shipment, order, dispute, payout and refund states', () => {
    expect(fn).toMatch(
      /s\.status NOT IN \('completed', 'cancelled', 'refunded'\)/,
    );
    expect(fn).toMatch(
      /o\.status NOT IN \('completed', 'cancelled', 'refunded'\)/,
    );
    expect(fn).toMatch(
      /status IN \('open', 'under_review', 'waiting_return', 'return_shipped', 'return_delivered'\)/,
    );
    expect(fn).toContain('public.admin_connect_payout_release_view');
    expect(fn).toContain('public.connect_payout_runs');
    expect(fn).toMatch(/'pending_reconciliation', 'reconciliation_needed'/);
    expect(fn).toContain('public.shipment_cancellation_operations');
    expect(fn).toContain('refund_resolved_at IS NULL');
    expect(fn).toContain('compensation_state');
    expect(fn).toContain('public.wallets');
    expect(fn).toContain('public.payout_requests');
    expect(fn).toMatch(/status IN \('pending', 'processing'\)/);
  });

  test('anonymizes the public and private profile', () => {
    expect(fn).toMatch(/UPDATE public\.profiles SET[^;]*deleted_at = now\(\)/i);
    // A taken candidate (another closure or a user-chosen name) must not abort
    // the closure with a unique violation: try the next candidate instead.
    expect(fn).toMatch(/v_username := 'deleted_' \|\| substr\(md5\(/);
    expect(fn).toMatch(
      /EXIT WHEN NOT EXISTS \( ?SELECT 1 FROM public\.profiles WHERE username = v_username/i,
    );
    expect(fn).toMatch(/username = v_username/);
    expect(fn).toMatch(/avatar_url = NULL/);
    expect(fn).toMatch(/UPDATE public\.profiles_private SET[^;]*email = NULL/i);
    for (const column of [
      'phone_number = NULL',
      'stripe_customer_id = NULL',
      'stripe_account_id = NULL',
      'last_sign_in_at = NULL',
    ]) {
      expect(fn).toContain(column);
    }
  });

  test('deletes personal rows, scrubs addresses kept for shipments and soft-deletes unsold listings', () => {
    for (const table of [
      'public.payment_methods',
      'public.favorites',
      'public.blocked_users',
      'public.notifications',
    ]) {
      expect(fn).toContain(`DELETE FROM ${table}`);
    }
    expect(fn).toMatch(/blocker_id = p_user_id OR blocked_id = p_user_id/);
    expect(fn).toMatch(/DELETE FROM public\.addresses[^;]*NOT EXISTS/i);
    expect(fn).toMatch(/UPDATE public\.addresses SET/i);
    expect(fn).toMatch(
      /UPDATE public\.products SET deleted_at = now\(\), status = 'HIDDEN'[^;]*NOT EXISTS ?\( ?SELECT 1 FROM public\.order_items/i,
    );
  });

  test('never touches the ledger tables', () => {
    for (const table of [
      'orders',
      'order_items',
      'shipments',
      'disputes',
      'reviews',
      'reports',
      'admin_audit_logs',
      'connect_payout_runs',
      'connect_payout_run_shipments',
    ]) {
      expect(fn).not.toMatch(
        new RegExp(`(UPDATE|DELETE FROM|INSERT INTO) public\\.${table}\\b`, 'i'),
      );
    }
  });

  test('closes the auth side in the same transaction and keeps the auth.users row', () => {
    expect(fn).toMatch(/UPDATE auth\.users SET[^;]*email = NULL/i);
    for (const fragment of [
      'phone = NULL',
      "encrypted_password = ''",
      'raw_user_meta_data',
      'raw_app_meta_data',
      "confirmation_token = ''",
      "recovery_token = ''",
      "email_change = ''",
      'banned_until',
    ]) {
      expect(fn).toContain(fragment);
    }
    expect(fn).not.toMatch(/infinity/i);
    expect(fn).not.toMatch(/DELETE FROM auth\.users/i);
    for (const table of [
      'auth.identities',
      'auth.sessions',
      'auth.refresh_tokens',
      'auth.mfa_factors',
      'auth.one_time_tokens',
      'auth.flow_state',
      'auth.webauthn_credentials',
    ]) {
      expect(fn).toContain(`DELETE FROM ${table}`);
    }
  });

  test('records the closure and returns the ids the Edge Function must clean up', () => {
    expect(fn).toMatch(/INSERT INTO public\.account_closures/i);
    expect(fn).toContain("'closed'");
    expect(fn).toContain("'stripe_customer_id'");
    expect(fn).toContain("'stripe_account_id'");
  });

  test('does not commit, so a blocked or failed call changes nothing', () => {
    expect(fn).not.toMatch(/\bCOMMIT\b/i);
    expect(fn).not.toMatch(/EXCEPTION WHEN OTHERS THEN NULL/i);
  });
});
