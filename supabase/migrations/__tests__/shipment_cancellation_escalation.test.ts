import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_cancellation_escalation.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const escalation = read('supabase/queries/orders/shipment_cancellation_escalation.sql');

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-cancellation-refund-status.ts
// prove the behavior in PostgreSQL.
describe('shipment cancellation escalation migration (SQL text)', () => {
  it('is exactly one active migration containing both canonical copies', () => {
    expect(migrations).toHaveLength(1);
    expect(statements(migration)).toContain(statements(escalation));
    // The recovery read's canonical copy moved on in B2.2.1 (the B2.2 migration keeps the old body).
    expect(statements(migration)).toContain(
      statements(read('supabase/queries/orders/shipment_cancellation_recovery.sql')),
    );
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('drops nothing and grants the escalation RPC to service_role only', () => {
    expect(migration).not.toMatch(/DROP\s/i);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_escalate_shipment_cancellation\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_escalate_shipment_cancellation\([^)]*\) TO service_role;/);
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  it('adds the escalation columns with a both-or-neither CHECK and known reasons', () => {
    const body = statements(escalation);
    expect(body).toContain('ADD COLUMN recovery_escalated_at TIMESTAMPTZ');
    expect(body).toContain('ADD COLUMN recovery_escalation_reason TEXT');
    expect(body).toContain("recovery_escalation_reason IN ('refund_not_found', 'refund_ambiguous')");
    expect(body).toContain('(recovery_escalated_at IS NULL) = (recovery_escalation_reason IS NULL)');
  });

  it('runs the escalation as a locked-down SECURITY DEFINER that only fills NULL escalations', () => {
    const body = statements(escalation);
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toContain("SET search_path = ''");
    expect(body).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;");
    expect(body).toContain("RAISE EXCEPTION 'CANCELLATION_NOT_STARTED'");
    expect(body).toContain("RAISE EXCEPTION 'INVALID_ESCALATION_REASON'");
    expect(body.indexOf('FROM public.shipments WHERE id = p_shipment_id FOR UPDATE')).toBeGreaterThan(-1);
    expect(body.indexOf('FROM public.shipments WHERE id = p_shipment_id FOR UPDATE')).toBeLessThan(
      body.indexOf('FROM public.shipment_cancellation_operations'),
    );
  });

  it('the recovery read also returns recovery_escalated_at', () => {
    expect(read('supabase/queries/orders/shipment_cancellation_recovery.sql')).toContain(
      "'recovery_escalated_at', v_operation.recovery_escalated_at",
    );
  });
});
