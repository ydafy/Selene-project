import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static validation for single-modal multi-seller checkout settlement
 * foundation (Batch 1 / Work Unit 1: DB & Types).
 *
 * These tests do NOT exercise a live Postgres database (Supabase changes are
 * applied manually by the user per workflow/supabase-manual-apply). They guard
 * the SQL source artifact statically so the migration stays deployable,
 * backward-compatible, and consistent with the spec/design.
 *
 * Covered acceptance criteria (from spec/design):
 *   - orders gains stripe_charge_id, stripe_transfer_group, payment_processing,
 *     payment_processing_reason (legacy-safe: nullable except payment_processing
 *     which defaults false).
 *   - shipments gains stripe_transfer_id (nullable, written exactly once on release).
 *   - Settlement lookup indexes + unique guard on transfer_group.
 *   - admin_connect_payout_release_view is recreated to surface transfer_group
 *     (order-level) and stripe_transfer_id (shipment-level) without changing the
 *     existing eligibility gates (release-time transfer_group gating lands in a
 *     later batch).
 *   - service_role-only access preserved.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const findMigration = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith('.sql') && f.includes('single_modal_checkout'),
  );
  if (files.length === 0) {
    throw new Error('Migration file matching *single_modal_checkout*.sql not found');
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
};

describe('single-modal checkout settlement migration', () => {
  test('migration file exists in supabase/migrations', () => {
    expect(() => findMigration()).not.toThrow();
  });

  test('adds legacy-safe settlement columns to orders', () => {
    const sql = findMigration();
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.orders[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+stripe_charge_id\s+TEXT/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.orders[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+stripe_transfer_group\s+TEXT/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.orders[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+payment_processing\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.orders[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+payment_processing_reason\s+TEXT/i);
  });

  test('adds per-shipment transfer reference column to shipments', () => {
    const sql = findMigration();
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.shipments[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+stripe_transfer_id\s+TEXT/i);
  });

  test('documents each settlement column with a COMMENT', () => {
    const sql = findMigration();
    expect(sql).toMatch(/COMMENT\s+ON\s+COLUMN\s+public\.orders\.stripe_charge_id/i);
    expect(sql).toMatch(/COMMENT\s+ON\s+COLUMN\s+public\.orders\.stripe_transfer_group/i);
    expect(sql).toMatch(/COMMENT\s+ON\s+COLUMN\s+public\.orders\.payment_processing/i);
    expect(sql).toMatch(/COMMENT\s+ON\s+COLUMN\s+public\.orders\.payment_processing_reason/i);
    expect(sql).toMatch(/COMMENT\s+ON\s+COLUMN\s+public\.shipments\.stripe_transfer_id/i);
  });

  test('creates settlement lookup indexes', () => {
    const sql = findMigration();
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_orders_stripe_transfer_group\s+ON\s+public\.orders\s*\(\s*stripe_transfer_group\s*\)\s+WHERE\s+stripe_transfer_group\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_shipments_stripe_transfer_id\s+ON\s+public\.shipments\s*\(\s*stripe_transfer_id\s*\)\s+WHERE\s+stripe_transfer_id\s+IS\s+NOT\s+NULL/i);
  });

  test('creates a recovery index for payment_processing orders', () => {
    const sql = findMigration();
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_orders_payment_processing\s+ON\s+public\.orders\s*\(\s*payment_processing\s*\)\s+WHERE\s+payment_processing\s*=\s*true/i);
  });

  test('guards transfer_group uniqueness per order', () => {
    const sql = findMigration();
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_orders_stripe_transfer_group_unique\s+ON\s+public\.orders\s*\(\s*stripe_transfer_group\s*\)\s+WHERE\s+stripe_transfer_group\s+IS\s+NOT\s+NULL/i);
  });

  test('recreates admin release view to surface transfer_group and stripe_transfer_id', () => {
    const sql = findMigration();
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.admin_connect_payout_release_view/i);
    // transfer_group is sourced from the order-level column
    expect(sql).toMatch(/o\.stripe_transfer_group\s+AS\s+transfer_group/i);
    // stripe_transfer_id is sourced from the shipment-level column
    expect(sql).toMatch(/s\.stripe_transfer_id/i);
    // The view joins orders to read the order-level transfer_group
    expect(sql).toMatch(/JOIN\s+public\.orders\s+o\s+ON\s+o\.id\s*=\s*s\.order_id/i);
    // Both surfaced columns appear as view output columns
    expect(sql).toMatch(/\btransfer_group\b[\s\S]*\bstripe_transfer_id\b/i);
  });

  test('computes SCT release_amount_cents from allocation net only and keeps legacy shipping subtraction', () => {
    const sql = findMigration();
    expect(sql).toContain('WHEN o.stripe_transfer_group IS NOT NULL THEN');
    expect(sql).toContain(
      'ROUND(COALESCE(SUM(oi.net_payout), 0) * 100)::INTEGER',
    );
    expect(sql).toContain(
      'ELSE',
    );
    expect(sql).toContain(
      'ROUND(COALESCE(SUM(oi.net_payout), 0) * 100)::INTEGER - COALESCE(s.shipping_cost, 0)',
    );
    expect(sql).toMatch(
      /CASE\s+WHEN\s+o\.stripe_transfer_group\s+IS\s+NOT\s+NULL[\s\S]*?ROUND\(COALESCE\(SUM\(oi\.net_payout\),\s*0\)\s*\*\s*100\)::INTEGER[\s\S]*?ELSE[\s\S]*?ROUND\(COALESCE\(SUM\(oi\.net_payout\),\s*0\)\s*\*\s*100\)::INTEGER\s*-\s*COALESCE\(s\.shipping_cost,\s*0\)/i,
    );
    expect(sql).toMatch(/GREATEST\(/i);
  });

  test('preserves existing release eligibility gates and does not add transfer_group gating', () => {
    const sql = findMigration();
    // Existing gates from connect_manual_payout_release must remain intact.
    expect(sql).toContain("s.status = 'completed'");
    expect(sql).toContain('s.completed_at IS NOT NULL');
    expect(sql).toContain('s.stripe_payment_intent_id IS NOT NULL');
    expect(sql).toContain('has_shipping_cost_cents');
    expect(sql).toContain("WHEN NOT has_shipping_cost_cents THEN 'missing_shipping_cost'");
    expect(sql).toContain('ineligible_reason');
  });

  test('preserves service_role-only access on the recreated view', () => {
    const sql = findMigration();
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+public\.admin_connect_payout_release_view\s+FROM\s+anon,\s*authenticated/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+public\.admin_connect_payout_release_view\s+TO\s+service_role/i);
  });

  test('does not change order_status_enum (no payment_processing enum value)', () => {
    // Design rejects adding payment_processing to the status enum to avoid
    // enum churn and status-derivation regressions.
    const sql = findMigration();
    expect(sql).not.toMatch(/ALTER\s+TYPE\s+public\.order_status_enum[\s\S]*?payment_processing/i);
  });
});

/**
 * Extract the outer SELECT column list of the recreated view (the SELECT that
 * feeds `FROM shipment_amounts`). Used to statically verify CREATE OR REPLACE
 * VIEW column-order compatibility without a live database.
 */
const extractOuterSelectColumns = (sql: string): string => {
  const fromIdx = sql.lastIndexOf('FROM shipment_amounts');
  if (fromIdx === -1) throw new Error('outer "FROM shipment_amounts" not found');
  const lastSelectIdx = sql.lastIndexOf('SELECT', fromIdx);
  if (lastSelectIdx === -1) throw new Error('outer SELECT not found');
  return sql.slice(lastSelectIdx + 'SELECT'.length, fromIdx);
};

const indexOfColumn = (outerCols: string, col: string): number => {
  const m = new RegExp(`\\b${col}\\b`).exec(outerCols);
  return m ? m.index : -1;
};

describe('admin_connect_payout_release_view CREATE OR REPLACE compatibility', () => {
  /**
   * Regression: CREATE OR REPLACE VIEW requires the replaced view to keep the
   * existing column names, order, and types. New columns must be APPENDED at
   * the end of the outer SELECT, never inserted in the middle. Inserting
   * transfer_group/stripe_transfer_id between existing columns silently
   * renumbers every downstream position and breaks dependents (RPC selects,
   * admin contracts using positional/SELECT *).
   */
  test('preserves original column order and appends new columns at the tail', () => {
    const sql = findMigration();
    const outerCols = extractOuterSelectColumns(sql);
    // The original 12 columns from connect_manual_payout_release (20260621000000).
    const originalOrder = [
      'shipment_id',
      'seller_id',
      'seller_name',
      'order_id',
      'status',
      'completed_at',
      'stripe_payment_intent_id',
      'stripe_account_id',
      'stripe_onboarding_status',
      'release_amount_cents',
      'is_eligible',
      'ineligible_reason',
    ];
    // Every original column must still be present, in the same relative order.
    let prev = -1;
    for (const col of originalOrder) {
      const idx = indexOfColumn(outerCols, col);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(prev);
      prev = idx;
    }
    // New columns must be APPENDED strictly after the last original column
    // (ineligible_reason), not interleaved. This is the deployability invariant
    // CREATE OR REPLACE VIEW enforces.
    const lastOriginal = indexOfColumn(outerCols, 'ineligible_reason');
    expect(indexOfColumn(outerCols, 'transfer_group')).toBeGreaterThan(lastOriginal);
    expect(indexOfColumn(outerCols, 'stripe_transfer_id')).toBeGreaterThan(
      indexOfColumn(outerCols, 'transfer_group'),
    );
    // No previously-absent column must be silently surfaced inside the original
    // span (guards against accidental new columns like stripe_payout_id).
    expect(indexOfColumn(outerCols, 'stripe_payout_id')).toBe(-1);
  });

  /**
   * Contract: settlement identifiers must be sourced at the correct
   * granularity. transfer_group is ORDER-level (sourced from the orders alias
   * `o` via the orders JOIN); stripe_transfer_id is SHIPMENT-level (sourced
   * from the shipments alias `s`). The two must never be swapped or both read
   * from one relation, or the per-shipment release granularity breaks.
   */
  test('sources transfer_group at order level and stripe_transfer_id at shipment level', () => {
    const sql = findMigration();
    // Restrict to the recreated view block so table names (e.g. "orders." /
    // "shipments.") do not create false substring matches against alias refs.
    const viewStart = sql.indexOf('CREATE OR REPLACE VIEW public.admin_connect_payout_release_view');
    const viewBlock = sql.slice(
      viewStart,
      sql.indexOf('FROM shipment_amounts;', viewStart) + 'FROM shipment_amounts;'.length,
    );
    // transfer_group is read from the orders alias `o`.
    expect(viewBlock).toMatch(/o\.stripe_transfer_group\s+AS\s+transfer_group/i);
    // The view must join orders on the shipment's order_id.
    expect(viewBlock).toMatch(/JOIN\s+public\.orders\s+o\s+ON\s+o\.id\s*=\s*s\.order_id/i);
    // stripe_transfer_id is read from the shipments alias `s`.
    expect(viewBlock).toMatch(/(?<![A-Za-z_])s\.stripe_transfer_id\b/i);
    // Contract invariant: the shipment-level Transfer id must NEVER be sourced
    // from the orders alias (would be a granularity bug).
    expect(viewBlock).not.toMatch(/(?<![A-Za-z_])o\.stripe_transfer_id/i);
    // Contract invariant: the order-level transfer_group must NEVER be sourced
    // from the shipments alias (shipments has no stripe_transfer_group column).
    expect(viewBlock).not.toMatch(/(?<![A-Za-z_])s\.stripe_transfer_group/i);
  });
});
