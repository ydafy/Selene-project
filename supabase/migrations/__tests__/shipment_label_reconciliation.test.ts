import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const migrations = readdirSync(join(root, 'supabase/migrations')).filter(
  (name) => name.endsWith('_shipment_label_reconciliation.sql'),
);
const migration =
  migrations.length === 1 ? read(`supabase/migrations/${migrations[0]}`) : '';
const canonicalReconcile = read(
  'supabase/queries/shipments/fn_reconcile_shipment_label.sql',
);
const canonicalAdmin = read(
  'supabase/queries/shipments/shipment_label_reconciliation.sql',
);
const definition = (sql: string, name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf('\n$$;', start);
  return start === -1 || end === -1 ? '' : sql.slice(start, end + 4);
};

const signatures = {
  fn_shipment_label_is_stuck: 'public.order_status_enum, TEXT, TIMESTAMPTZ',
  fn_reconcile_shipment_label:
    'UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT',
  fn_list_shipment_label_reconciliations: '',
  fn_resolve_shipment_label_reconciliation:
    'UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT',
};

// Text contracts only; `supabase db reset` + scripts/test-shipment-label-reconciliation.ts
// prove the behavior in PostgreSQL.
describe('shipment label reconciliation migration (SQL text)', () => {
  it('is one migration after the grants parity migration, in one transaction', () => {
    expect(migrations).toHaveLength(1);
    expect(
      migrations[0]! > '20261028222400_function_execute_grants_parity.sql',
    ).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd()).toEndWith('COMMIT;');
  });

  it('keeps every function equal to its canonical file', () => {
    expect(definition(migration, 'fn_reconcile_shipment_label')).not.toBe('');
    expect(canonicalReconcile).toContain(
      definition(migration, 'fn_reconcile_shipment_label'),
    );
    for (const name of [
      'fn_shipment_label_is_stuck',
      'fn_list_shipment_label_reconciliations',
      'fn_resolve_shipment_label_reconciliation',
    ]) {
      const body = definition(migration, name);
      expect(body).not.toBe('');
      expect(canonicalAdmin).toContain(body);
    }
    expect(canonicalAdmin).toContain("'released'");
  });

  it('replaces the 10-argument reconcile function instead of leaving an overload', () => {
    expect(migration).toContain(
      'DROP FUNCTION public.fn_reconcile_shipment_label(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT);',
    );
  });

  it('allows a released event type next to the existing ones', () => {
    expect(migration).toContain('shipment_label_events_event_type_check');
    expect(migration).toContain("'reconciled', 'released'");
  });

  it('defines stuck once and uses it in list, resolve and reconcile', () => {
    const stuck = definition(migration, 'fn_shipment_label_is_stuck');
    expect(stuck).toContain("'orphan_pending'");
    expect(stuck).toContain("('claimed', 'generation_sent')");
    expect(stuck).toContain('clock_timestamp()');
    for (const name of [
      'fn_reconcile_shipment_label',
      'fn_list_shipment_label_reconciliations',
      'fn_resolve_shipment_label_reconciliation',
    ]) {
      expect(definition(migration, name)).toContain(
        'public.fn_shipment_label_is_stuck(',
      );
    }
  });

  it('checks service role, the active-admin rule and the note in both writers', () => {
    for (const name of [
      'fn_reconcile_shipment_label',
      'fn_resolve_shipment_label_reconciliation',
    ]) {
      const body = definition(migration, name);
      expect(body).toContain("auth.role() IS DISTINCT FROM 'service_role'");
      expect(body).toContain(
        "role = 'admin' AND COALESCE(status::text, 'active') = 'active'",
      );
      expect(body).toContain("SET search_path = ''");
      expect(body).toContain('SECURITY DEFINER');
    }
    const resolve = definition(
      migration,
      'fn_resolve_shipment_label_reconciliation',
    );
    for (const code of [
      'ADMIN_REQUIRED',
      'INVALID_RESOLUTION',
      'INVALID_RESOLUTION_NOTE',
      'SHIPMENT_NOT_FOUND',
    ]) {
      expect(resolve).toContain(code);
    }
    expect(resolve).toContain('already_resolved');
    expect(resolve).toContain('FOR UPDATE');
    expect(resolve).toContain('public.fn_reconcile_shipment_label(');
  });

  it('releases to unclaimed without touching money or the order', () => {
    const resolve = definition(
      migration,
      'fn_resolve_shipment_label_reconciliation',
    );
    expect(resolve).toContain("label_generation_state = 'unclaimed'");
    expect(resolve).toContain('claim_token = NULL');
    expect(resolve).not.toMatch(
      /(INSERT INTO|UPDATE|DELETE FROM)\s+public\.(orders|notifications|shipment_cancellation_operations)\b/,
    );
    expect(resolve).not.toMatch(/status = '/);
  });

  it('lists oldest first and exposes the reconciliation context', () => {
    const list = definition(
      migration,
      'fn_list_shipment_label_reconciliations',
    );
    expect(list).toContain('ORDER BY');
    for (const column of [
      'seller_name',
      'buyer_name',
      'stuck_at',
      'quote_carrier',
      'quote_cost_cents',
      'origin_postal_code',
      'destination_postal_code',
    ]) {
      expect(list).toContain(column);
    }
  });

  it('revokes client EXECUTE and grants service_role for every function it creates', () => {
    for (const [name, args] of Object.entries(signatures)) {
      const signature = `public.${name}(${args})`;
      expect(migration).toContain(
        `REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`,
      );
    }
    expect(migration).not.toMatch(
      /GRANT[^;]*\bTO (anon|authenticated|PUBLIC)\b/,
    );
  });
});
