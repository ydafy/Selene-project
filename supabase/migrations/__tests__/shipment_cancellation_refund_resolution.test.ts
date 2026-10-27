import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) =>
  name.endsWith('_shipment_cancellation_refund_resolution.sql'),
);
const migration = migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !/^\s*(--|BEGIN;|COMMIT;)/.test(line) && line.trim() !== '')
    .join('\n');
const resolution = read('supabase/queries/orders/shipment_cancellation_refund_resolution.sql');
const cancel = read('supabase/queries/orders/fn_cancel_shipment.sql');
const body = (sql: string) => sql.match(/CREATE OR REPLACE FUNCTION public\.fn_cancel_shipment\([\s\S]*?\$\$;/)?.[0] ?? '';
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
// remove-legacy-wallet T4 dropped the seller wallet reversal from the canonical fn_cancel_shipment; the
// deployed bodies in older migrations still carry it, so strip it before comparing.
const withoutWalletReversal = (sql: string) =>
  sql
    .replace(/\n {2}v_(wallet_id|wallet_pending|wallet_available|total_refund) [A-Z]+;/g, '')
    .replace(/ {2}-- 4\. Sum the shipment[\s\S]*?(?= {2}-- 6\. Release products)/, '')
    .replace('-- 6. Release products', '-- 4. Release products')
    .replace('-- 7. Mark the shipment', '-- 5. Mark the shipment');
// Everything the resolution change touches in fn_cancel_shipment: one declaration and the guard.
const withoutResolutionGuard = (sql: string) =>
  normalize(
    body(sql)
      .replace(/\n\s*v_refund_resolved_at TIMESTAMPTZ;/, '')
      .replace(/ {2}-- The Stripe refund must be recorded[\s\S]*?END IF;\n/, ''),
  );

// B2.4a replaced the status CHECK and the resolve function in a later migration, so this (deployed)
// migration is compared with the canonical columns section minus that CHECK.
const columnsSection = (sql: string) =>
  statements(sql.slice(0, sql.indexOf('-- Marks a failed/canceled shipment refund')))
    .replace(
      /,\n {2}ADD CONSTRAINT shipment_cancellation_operations_refund_resolution_status CHECK \([\s\S]*?\n {2}\)/,
      '',
    );

// Text contracts only; the local `supabase db reset` + scripts/test-shipment-cancellation-refund-resolution.ts
// prove the behavior in PostgreSQL.
describe('shipment cancellation refund resolution migration (SQL text)', () => {
  it('is exactly one active migration containing both canonical copies', () => {
    expect(migrations).toHaveLength(1);
    expect(columnsSection(migration)).toContain(columnsSection(resolution));
    expect(columnsSection(resolution)).toContain('ADD COLUMN refund_resolved_at TIMESTAMPTZ');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.fn_resolve_shipment_cancellation_refund(');
    expect(statements(withoutWalletReversal(migration))).toContain(
      statements(cancel).replace(/^DROP FUNCTION[^\n]*\n/m, ''),
    );
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('replaces fn_cancel_shipment with the same signature, no DROP, and a guard that accepts a resolved refund', () => {
    expect(migration).not.toMatch(/DROP\s/i);
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.fn_cancel_shipment(');
    expect(migration).toContain('p_cancellation_loss_cents BIGINT DEFAULT NULL');
    expect(cancel).toContain(
      "IF v_refund_status IS DISTINCT FROM 'succeeded' AND v_refund_resolved_at IS NULL THEN",
    );
    expect(cancel).toContain('SELECT refund_status, refund_resolved_at INTO v_refund_status, v_refund_resolved_at');
    expect(cancel).toContain("RETURN QUERY SELECT false, 'REFUND_NOT_SUCCEEDED'::TEXT;");
  });

  it('changes nothing else in fn_cancel_shipment compared with the deployed B2.2 body', () => {
    const deployed = read('supabase/migrations/20261021052336_shipment_cancellation_recovery.sql');
    expect(withoutResolutionGuard(cancel)).toBe(withoutResolutionGuard(withoutWalletReversal(deployed)));
    expect(withoutResolutionGuard(cancel)).not.toBe('');
  });

  it('adds the resolution columns with all-or-nothing and failed/canceled-only CHECKs', () => {
    const sql = statements(resolution);
    for (const column of ['refund_resolved_at TIMESTAMPTZ', 'refund_resolved_by UUID', 'refund_resolution_reference TEXT']) {
      expect(sql).toContain(`ADD COLUMN ${column}`);
    }
    expect(sql).toContain('(refund_resolved_at IS NULL) = (refund_resolved_by IS NULL)');
    expect(sql).toContain('(refund_resolved_at IS NULL) = (refund_resolution_reference IS NULL)');
    expect(sql).toContain("OR COALESCE(refund_status IN ('failed', 'canceled'), FALSE)");
    expect(sql).toContain('char_length(refund_resolution_reference) BETWEEN 1 AND 200');
  });

  it('grants the resolve RPC to service_role only', () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.fn_resolve_shipment_cancellation_refund\(UUID, UUID, TEXT\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_resolve_shipment_cancellation_refund\(UUID, UUID, TEXT\) TO service_role;/,
    );
    expect(migration).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
    expect(migration).toContain('-- Service-only');
  });

  it('is a locked-down SECURITY DEFINER that audits and completes through fn_cancel_shipment with the stored winner', () => {
    const sql = statements(resolution);
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;");
    expect(sql).toContain("RAISE EXCEPTION 'INVALID_RESOLUTION_REFERENCE'");
    expect(sql).toContain("RAISE EXCEPTION 'REFUND_NOT_RESOLVABLE'");
    expect(sql).toContain("RAISE EXCEPTION 'SHIPMENT_STATUS_UNEXPECTED");
    expect(sql).toContain("RAISE EXCEPTION 'CANCELLATION_COMPLETE_FAILED");
    expect(sql).toContain('INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)');
    expect(sql).toContain("'SHIPMENT_REFUND_RESOLVED'");
    expect(sql).toContain('public.fn_cancel_shipment(');
    expect(sql).toContain("CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END");
    expect(sql).toContain('v_operation.reason');
    expect(sql).toContain('v_operation.cancellation_loss_cents');
    // Lock order: shipment first, then the operation.
    expect(sql.indexOf('FROM public.shipments')).toBeLessThan(sql.indexOf('FROM public.shipment_cancellation_operations'));
    expect(sql).toContain('COMMENT ON FUNCTION public.fn_resolve_shipment_cancellation_refund(UUID, UUID, TEXT)');
  });
});
