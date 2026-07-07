import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static validation for the single-modal settlement RPC migration
 * (Blocker 2 fix: settlement RPC missing from migration path).
 *
 * Before this migration, the webhook invoked `fn_create_shipments_from_single_payment`
 * but the RPC only existed in `supabase/queries/orders/fn_create_shipments_from_single_payment.sql`
 * — no migration contained it, so `supabase db push` / migration replay would
 * NOT deploy the function and the webhook call would fail at runtime. These
 * guards ensure the deployable migration path contains the RPC and that the
 * migration body stays byte-identical to the canonical `queries/` source so
 * the two never silently drift.
 *
 * These tests do NOT exercise a live Postgres database (Supabase changes are
 * applied manually by the user per workflow/supabase-manual-apply). They guard
 * the SQL source artifact statically so the migration stays deployable and
 * consistent with the spec/design + the existing singleModalSettlementSqlGuards
 * contract for the queries/ file.
 */

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const QUERIES_RPC_PATH = join(
  import.meta.dir,
  '..',
  '..',
  'queries',
  'orders',
  'fn_create_shipments_from_single_payment.sql',
);

const RPC_MIGRATION_NAME_FRAGMENT = 'single_modal_settlement_rpc';

const findRpcMigrationPath = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith('.sql') && f.includes(RPC_MIGRATION_NAME_FRAGMENT),
  );
  if (files.length === 0) {
    throw new Error(
      'Migration file matching *single_modal_settlement_rpc*.sql not found',
    );
  }
  if (files.length > 1) {
    throw new Error(
      `Multiple migration files match *${RPC_MIGRATION_NAME_FRAGMENT}*.sql: ${files.join(', ')}`,
    );
  }
  return join(MIGRATIONS_DIR, files[0]);
};

const findRpcMigrationName = (): string => {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith('.sql') && f.includes(RPC_MIGRATION_NAME_FRAGMENT),
  );
  if (files.length !== 1) {
    throw new Error(
      'Expected exactly one single_modal_settlement_rpc migration',
    );
  }
  return files[0];
};

describe('single-modal settlement RPC migration', () => {
  test('migration file exists in supabase/migrations', () => {
    expect(() => findRpcMigrationPath()).not.toThrow();
  });

  test('runs strictly AFTER the SCT schema migration (dependency ordering)', () => {
    // The RPC body writes orders.stripe_charge_id / stripe_transfer_group /
    // payment_processing / payment_processing_reason and
    // shipments.stripe_transfer_id, all added by 20260702000000_single_modal_checkout_settlement.sql.
    // The RPC migration timestamp must therefore be greater than the SCT
    // migration timestamp so migration replay applies schema before the RPC.
    const sctFiles = readdirSync(MIGRATIONS_DIR).filter(
      (f) => f.endsWith('.sql') && f.includes('single_modal_checkout'),
    );
    expect(sctFiles.length).toBeGreaterThan(0);
    const sctName = sctFiles.sort()[0];
    const rpcName = findRpcMigrationName();
    expect(rpcName.localeCompare(sctName)).toBeGreaterThan(0);
  });

  test('declares fn_create_shipments_from_single_payment with the platform-pi signature', () => {
    const sql = readFileSync(findRpcMigrationPath(), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_create_shipments_from_single_payment(',
    );
    expect(sql).toContain('p_stripe_payment_intent_id TEXT');
    expect(sql).toContain('p_stripe_charge_id TEXT');
    expect(sql).toContain('p_amount_received BIGINT');
    expect(sql).toContain('p_transfer_group TEXT');
    expect(sql).toContain('p_allocation JSONB');
    expect(sql).toContain('RETURNS JSONB');
    expect(sql).toContain('LANGUAGE plpgsql');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
  });

  test('is idempotent on stripe_payment_intent_id (looks up an existing order first)', () => {
    const sql = readFileSync(findRpcMigrationPath(), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    expect(sql).toContain(
      'WHERE stripe_payment_intent_id = p_stripe_payment_intent_id',
    );
    expect(sql).toContain('FOR UPDATE');
  });

  test('creates the order shell before the allocation attempt and seeds status=pending', () => {
    const sql = readFileSync(findRpcMigrationPath(), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    const insertOrderIdx = sql.indexOf('INSERT INTO public.orders');
    const allocateIdx = sql.indexOf('EXCEPTION WHEN OTHERS THEN');
    expect(insertOrderIdx).toBeGreaterThan(-1);
    expect(allocateIdx).toBeGreaterThan(insertOrderIdx);
    expect(sql).toContain("'pending'");
    expect(sql).toContain('payment_processing');
  });

  test('advances shipment to paid and derives order status on success', () => {
    const sql = readFileSync(findRpcMigrationPath(), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    expect(sql).toContain("'paid'");
    expect(sql).toContain('fn_derive_order_status');
  });

  test('on allocation-write failure returns a typed recovery payload (NOT a raise)', () => {
    const sql = readFileSync(findRpcMigrationPath(), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    expect(sql).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(sql).toContain('payment_processing = true');
    expect(sql).toContain('payment_processing_reason');
    expect(sql).toContain("'status', 'payment_processing'");
    expect(sql).toContain("'success', false");
  });

  test('grants EXECUTE to service_role ONLY (revoked from PUBLIC/anon/authenticated)', () => {
    const sql = readFileSync(findRpcMigrationPath(), 'utf8');
    expect(sql).toContain('REVOKE EXECUTE');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE');
    expect(sql).toContain('TO service_role');
  });

  test('the migration body is byte-identical to the canonical queries/ RPC source (no drift)', () => {
    // Blocker 2 requires the deployable migration path to contain the RPC.
    // We embed the exact CREATE OR REPLACE FUNCTION block from
    // supabase/queries/orders/fn_create_shipments_from_single_payment.sql and
    // guard against the two copies drifting: extracting the function block
    // (from `CREATE OR REPLACE FUNCTION` to the final `TO service_role;` grant)
    // from BOTH files and asserting equality catches any future edit that
    // updates only one copy.
    const migrationSql = readFileSync(findRpcMigrationPath(), 'utf8');
    const queriesSql = readFileSync(QUERIES_RPC_PATH, 'utf8');

    const extractFunctionBlock = (src: string): string => {
      const start = src.indexOf(
        'CREATE OR REPLACE FUNCTION public.fn_create_shipments_from_single_payment',
      );
      expect(start).toBeGreaterThan(-1);
      const end = src.lastIndexOf('TO service_role;');
      expect(end).toBeGreaterThan(start);
      // Normalize line endings so CRLF/LF differences between the two files
      // do not cause a false drift failure.
      return src
        .slice(start, end + 'TO service_role;'.length)
        .replace(/\r\n/g, '\n');
    };

    expect(extractFunctionBlock(migrationSql)).toBe(
      extractFunctionBlock(queriesSql),
    );
  });

  test('migration declares the SCT schema migration as a prerequisite', () => {
    // Documents the runtime ordering dependency (schema columns must exist
    // before the RPC body can write them) so future readers know why this
    // migration is timestamped strictly after 20260702000000.
    const sql = readFileSync(findRpcMigrationPath(), 'utf8');
    expect(sql).toContain('Prerequisite: single_modal_checkout_settlement');
    expect(sql).toContain('20260702000000');
  });
});

describe('migration path contains the single-modal settlement RPC (Blocker 2 regression)', () => {
  test('at least one migration declares fn_create_shipments_from_single_payment', () => {
    // The original Blocker 2 evidence: the webhook called the RPC, the RPC
    // existed only under queries/, and NO migration contained it. This guard
    // scans the whole migrations directory so the deployable path can never
    // quietly lose the RPC again.
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);

    const declaring = files.filter((f) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      return sql.includes(
        'CREATE OR REPLACE FUNCTION public.fn_create_shipments_from_single_payment',
      );
    });

    expect(declaring.length).toBeGreaterThanOrEqual(1);
    expect(declaring.some((f) => f.includes(RPC_MIGRATION_NAME_FRAGMENT))).toBe(
      true,
    );
  });
});
