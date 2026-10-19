import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(
  import.meta.dir,
  '..',
  '20261019000000_revoke_public_definer_execute.sql',
);
const sql = readFileSync(file, 'utf8').replace(/\s+/g, ' ');

describe('revoke public SECURITY DEFINER execute (SQL structural only)', () => {
  test('runs in one transaction', () => {
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });

  test('cron-only reconciliation is no longer callable by API roles', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toContain(
        `REVOKE EXECUTE ON FUNCTION public.fn_reconcile_connect_payments() FROM ${role};`,
      );
    }
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_reconcile_connect_payments() TO service_role;',
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_reconcile_connect_payments\(\) TO (anon|authenticated|PUBLIC)/,
    );
  });

  test('admin product lock requires a signed-in caller', () => {
    for (const role of ['PUBLIC', 'anon']) {
      expect(sql).toContain(
        `REVOKE EXECUTE ON FUNCTION public.fn_lock_product(uuid) FROM ${role};`,
      );
    }
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_lock_product(uuid) TO authenticated, service_role;',
    );
  });

  test('keeps is_admin callable because public RLS policies depend on it', () => {
    expect(sql).not.toMatch(/REVOKE[^;]*is_admin/);
  });

  test('changes privileges only, never function bodies or data', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE|ALTER FUNCTION|DROP |UPDATE |DELETE |INSERT /i);
  });
});
