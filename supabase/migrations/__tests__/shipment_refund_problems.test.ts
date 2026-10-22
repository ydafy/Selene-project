import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_refund_problems.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const resolution = read('supabase/queries/orders/shipment_cancellation_refund_resolution.sql');
const problems = read('supabase/queries/orders/shipment_refund_problems.sql');
const resolveFunction = (sql: string) =>
  sql.match(/CREATE OR REPLACE FUNCTION public\.fn_resolve_shipment_cancellation_refund\([\s\S]*?\$\$;/)?.[0] ?? '';
const statusCheck = (sql: string) =>
  sql.match(/ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_status CHECK \([\s\S]*?\n {2}\)/)?.[0] ?? '';

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-refund-problems.ts
// prove the behavior in PostgreSQL.
describe('shipment refund problems migration (SQL text)', () => {
  it('is exactly one active migration, sorted after the refund resolution migration', () => {
    expect(migrations).toHaveLength(1);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
    const resolutionMigration = readdirSync(join(root, 'supabase/migrations')).find((name) =>
      name.endsWith('_shipment_cancellation_refund_resolution.sql'),
    );
    expect(migrations[0] > (resolutionMigration ?? '~')).toBe(true);
  });

  it('contains the canonical resolution function, the replaced status CHECK and the list function', () => {
    expect(resolveFunction(resolution)).not.toBe('');
    expect(statements(migration)).toContain(statements(resolveFunction(resolution)));
    expect(statements(migration)).toContain(statements(problems));
    const check = statusCheck(resolution);
    expect(check).not.toBe('');
    expect(statements(migration)).toContain(statements(check));
    expect(migration).toContain(
      'DROP CONSTRAINT shipment_cancellation_operations_refund_resolution_status',
    );
  });

  it('lets an escalated operation without a recorded refund be resolved, nothing else', () => {
    const check = statements(statusCheck(resolution));
    expect(check).toContain("COALESCE(refund_status IN ('failed', 'canceled'), FALSE)");
    expect(check).toContain('refund_id IS NULL AND refund_status IS NULL AND recovery_escalated_at IS NOT NULL');
    const body = statements(resolveFunction(resolution));
    expect(body).toContain("'escalation_reason'");
    expect(body).toContain('v_operation.recovery_escalation_reason');
    // Escalation markers are history: the resolution never writes them.
    expect(body).not.toMatch(/SET[^;]*recovery_escalat/i);
    expect(body).toContain("RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE'");
    expect(body).toContain("RAISE EXCEPTION 'SHIPMENT_STATUS_UNEXPECTED");
  });

  it('keeps the resolve RPC service-only', () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_resolve_shipment_cancellation_refund\(UUID, UUID, TEXT\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_resolve_shipment_cancellation_refund\(UUID, UUID, TEXT\) TO service_role;/,
    );
  });

  it('lists unresolved refund problems through a locked-down service-only SECURITY DEFINER', () => {
    const sql = statements(problems);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_list_shipment_refund_problems()');
    expect(sql).toContain('RETURNS TABLE');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;");
    expect(sql).toContain('refund_resolved_at IS NULL');
    for (const kind of ['refund_failed', 'refund_canceled', 'refund_not_found', 'refund_ambiguous']) {
      expect(sql).toContain(kind);
    }
    expect(sql).toContain('ORDER BY');
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_list_shipment_refund_problems\(\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_list_shipment_refund_problems\(\) TO service_role;/);
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
    expect(problems).toContain('-- Service-only');
    expect(sql).toContain('COMMENT ON FUNCTION public.fn_list_shipment_refund_problems()');
  });
});
