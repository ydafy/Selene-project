import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-contract guards for the account-status lifecycle (auth-hardening T1b, D3/D7).
 * Static checks only: they do not prove PostgreSQL behavior or remote deployment.
 *
 * Same-status updates are intentionally allowed (except banned -> other): they refresh
 * reason/audit, never restore products, and re-running the hold is idempotent.
 */

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => {
  const absolute = join(root, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n') : '';
};
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const migration = read('supabase/migrations/archive/20261018120000_account_status_lifecycle.sql');
const statusSource = read('supabase/queries/admin/fn_admin_update_user_status.sql');
const isAdminSource = read('supabase/queries/auth/is_admin.sql');

const functionBlock = (name: string) =>
  migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`),
  );
const statusBlock = functionBlock('fn_admin_update_user_status');
const isAdminBlock = functionBlock('is_admin');
const statusBody = statusBlock?.[1] ?? '';
const isAdminBody = isAdminBlock?.[1] ?? '';

describe('account status lifecycle migration', () => {
  test('is a single transaction that adds the nullable hold column idempotently', () => {
    expect(migration).toMatch(/^(--.*\n)+BEGIN;\n/);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
    expect(migration).toContain(
      'ALTER TABLE public.products\n  ADD COLUMN IF NOT EXISTS status_before_account_hold public.product_status_enum;',
    );
    expect(migration).not.toMatch(/status_before_account_hold public\.product_status_enum\s+NOT NULL/i);
    expect(migration).toContain('COMMENT ON COLUMN public.products.status_before_account_hold IS');
    expect(migration).not.toMatch(/DROP FUNCTION|GRANT EXECUTE|REVOKE EXECUTE/i);
  });

  test('replaces only the deployed four-argument status RPC (no new overload)', () => {
    expect(statusBlock?.[0]).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_admin_update_user_status(\n  p_target_user_id UUID,\n  p_admin_id UUID,\n  p_new_status public.account_status,\n  p_reason TEXT\n)\nRETURNS BOOLEAN\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $$',
    );
    expect(migration.match(/CREATE OR REPLACE FUNCTION public\.fn_admin_update_user_status\(/g)).toHaveLength(1);
    expect(migration).toContain(
      "to_regprocedure('public.fn_admin_update_user_status(uuid,uuid,public.account_status,text)')",
    );
    expect(migration).toContain("p.proname = 'fn_admin_update_user_status'");
  });

  test('replaces is_admin() with the same signature and attributes', () => {
    expect(isAdminBlock?.[0]).toContain(
      'CREATE OR REPLACE FUNCTION public.is_admin()\nRETURNS BOOLEAN\nLANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path = public\nAS $$',
    );
    expect(migration).toContain("to_regprocedure('public.is_admin()')");
  });

  test('migration bodies equal the canonical query copies', () => {
    expect(statusSource).not.toBe('');
    expect(isAdminSource).not.toBe('');
    expect(normalize(statusBody)).toBe(normalize(statusSource));
    expect(normalize(isAdminBody)).toBe(normalize(isAdminSource));
  });
});

describe.each([
  ['migration body', () => statusBody],
  ['canonical copy', () => statusSource],
])('fn_admin_update_user_status %s', (_label, body) => {
  test('keeps JWT actor, admin check and error logging contract', () => {
    const sql = body();
    expect(sql).toContain("v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;");
    expect(sql).toContain("RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';");
    expect(sql).toMatch(/IF NOT is_admin\(\) THEN\s+RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';/);
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*INSERT INTO public\.system_logs[\s\S]*RAISE;\s*END;\s*$/);
    expect(sql).not.toMatch(/p_admin_id/);
  });

  test('rejects self status changes after the admin check', () => {
    const sql = body();
    expect(sql).toMatch(
      /IF p_target_user_id = v_auth_user_id THEN\s+RAISE EXCEPTION 'CANNOT_CHANGE_OWN_STATUS';/,
    );
    expect(sql.indexOf('UNAUTHORIZED_ADMIN_ONLY')).toBeLessThan(sql.indexOf('CANNOT_CHANGE_OWN_STATUS'));
  });

  test('locks the target row and returns false when it is missing', () => {
    const sql = body();
    expect(sql).toMatch(
      /SELECT COALESCE\(status, 'active'\)\s+INTO v_previous_status\s+FROM public\.profiles_private\s+WHERE id = p_target_user_id\s+FOR UPDATE;\s+IF NOT FOUND THEN\s+RETURN false;/,
    );
    expect(sql.indexOf('FOR UPDATE')).toBeLessThan(sql.indexOf('UPDATE public.profiles_private'));
  });

  test('rejects a NULL target status before any write (NULL would read as active)', () => {
    const sql = body();
    expect(sql).toMatch(/IF p_new_status IS NULL THEN\s+RAISE EXCEPTION 'INVALID_ACCOUNT_STATUS';/);
    expect(sql.indexOf('INVALID_ACCOUNT_STATUS')).toBeLessThan(sql.indexOf('FOR UPDATE'));
    expect(sql.indexOf('INVALID_ACCOUNT_STATUS')).toBeLessThan(sql.indexOf('UPDATE public.profiles_private'));
  });

  test('clears stale holds on listings an admin moved out of HIDDEN during the suspension', () => {
    const sql = body();
    const restore = sql.indexOf('SET status = status_before_account_hold,');
    const cleanup = sql.search(
      /UPDATE public\.products\s+SET status_before_account_hold = NULL\s+WHERE seller_id = p_target_user_id\s+AND status_before_account_hold IS NOT NULL\s+AND status <> 'HIDDEN'::public\.product_status_enum;/,
    );
    expect(restore).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(restore);
    expect(cleanup).toBeLessThan(sql.indexOf('INSERT INTO public.admin_audit_logs'));
  });

  test('treats banned as final before any write', () => {
    const sql = body();
    expect(sql).toMatch(
      /IF v_previous_status = 'banned' AND p_new_status <> 'banned' THEN\s+RAISE EXCEPTION 'BANNED_IS_FINAL';/,
    );
    expect(sql.indexOf('BANNED_IS_FINAL')).toBeLessThan(sql.indexOf('UPDATE public.profiles_private'));
  });

  test('records the prior product status without overwriting an existing hold', () => {
    const sql = body();
    expect(sql).toMatch(
      /IF p_new_status IN \('suspended', 'banned'\) THEN\s+UPDATE public\.products\s+SET status_before_account_hold = COALESCE\(status_before_account_hold, status\),\s+status = 'HIDDEN'::public\.product_status_enum,\s+updated_at = now\(\)\s+WHERE seller_id = p_target_user_id\s+AND deleted_at IS NULL\s+AND status = ANY\(ARRAY\['VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW'\]::public\.product_status_enum\[\]\);/,
    );
  });

  test('restores only tracked hidden products on suspended -> active and clears the hold', () => {
    const sql = body();
    expect(sql).toMatch(
      /ELSIF p_new_status = 'active' AND v_previous_status = 'suspended' THEN\s+UPDATE public\.products\s+SET status = status_before_account_hold,\s+status_before_account_hold = NULL,\s+updated_at = now\(\)\s+WHERE seller_id = p_target_user_id\s+AND status = 'HIDDEN'::public\.product_status_enum\s+AND status_before_account_hold IS NOT NULL\s+AND deleted_at IS NULL;/,
    );
  });

  test('never blanket-restores products to VERIFIED', () => {
    const sql = body();
    expect(sql).not.toMatch(/SET\s+status\s*=\s*'VERIFIED'/i);
    expect(sql).not.toMatch(/status\s*=\s*'VERIFIED'::public\.product_status_enum\s*,/i);
  });

  test('audits the JWT actor with previous and new status', () => {
    const sql = body();
    expect(sql).toMatch(
      /INSERT INTO public\.admin_audit_logs \(admin_id, action_type, target_id, details\)\s+VALUES \(v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,\s+jsonb_build_object\('previous_status', v_previous_status::text, 'new_status', p_new_status::text, 'reason', p_reason\)\);/,
    );
    expect(sql).toContain('status_updated_by = v_auth_user_id::text');
  });
});

describe.each([
  ['migration body', () => isAdminBody],
  ['canonical copy', () => isAdminSource],
])('is_admin %s', (_label, body) => {
  test('requires the admin role and an active account for auth.uid()', () => {
    const sql = body();
    expect(sql).toMatch(
      /SELECT role, status\s+INTO v_role, v_status\s+FROM public\.profiles_private\s+WHERE id = auth\.uid\(\);/,
    );
    expect(sql).toContain("RETURN COALESCE(v_role = 'admin' AND COALESCE(v_status, 'active') = 'active', false);");
  });
});
