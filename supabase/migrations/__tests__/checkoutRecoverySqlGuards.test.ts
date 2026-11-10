import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSql = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8').replace(/\s+/g, ' ');

const readRetryHardeningMigration = () => {
  const migrationFile = readdirSync(
    join(process.cwd(), 'supabase/migrations/archive'),
  ).find((file) => file.endsWith('_standalone_recovery_retry_hardening.sql'));

  return {
    migrationFile,
    sql: migrationFile
      ? readSql(`supabase/migrations/archive/${migrationFile}`)
      : '',
  };
};

const readOperationalControlMigration = () => {
  const migrationFile = readdirSync(
    join(process.cwd(), 'supabase/migrations/archive'),
  ).find((file) =>
    file.endsWith('_checkout_recovery_worker_operational_control.sql'),
  );

  return {
    migrationFile,
    sql: migrationFile
      ? readSql(`supabase/migrations/archive/${migrationFile}`)
      : '',
  };
};

describe('checkout recovery SQL guards', () => {
  it('adds disabled-by-default operational controls for the recovery worker', () => {
    const { migrationFile, sql } = readOperationalControlMigration();

    expect(migrationFile).toBeDefined();
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS checkout_recovery_enabled BOOLEAN NOT NULL DEFAULT false',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS checkout_recovery_running BOOLEAN NOT NULL DEFAULT false',
    );
  });

  it('persists first-known charge evidence and terminalizes missing evidence for reconciliation', () => {
    const { sql: migration } = readRetryHardeningMigration();

    expect(migration).toContain('fn_set_checkout_recovery_charge_evidence');
    expect(migration).toContain(
      'stripe_charge_id = COALESCE(stripe_charge_id, p_stripe_charge_id)',
    );
    expect(migration).toContain(
      'fn_mark_checkout_recovery_reconciliation_needed',
    );
    expect(migration).toContain("compensation_state = 'reconciliation_needed'");
    expect(migration).toContain('compensation_lease_expires_at = NULL');
    expect(migration).toContain('next_compensation_retry_at = NULL');
  });

  it('creates the standalone recovery shell table', () => {
    const migration = readSql(
      'supabase/migrations/archive/20260826045628_paid_checkout_recovery.sql',
    );

    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS public.checkout_recovery_shells',
    );
    expect(migration).toContain('stripe_payment_intent_id TEXT PRIMARY KEY');
  });

  it('persists the first standalone charge id and returns it from standalone claims', () => {
    const { migrationFile, sql: migration } = readRetryHardeningMigration();

    expect(migrationFile).toBeDefined();
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT',
    );
    expect(migration).toContain('p_stripe_charge_id TEXT DEFAULT NULL');
    expect(migration).toContain(
      'stripe_charge_id = COALESCE(public.checkout_recovery_shells.stripe_charge_id, EXCLUDED.stripe_charge_id)',
    );
    expect(migration).toContain(
      'RETURNING s.stripe_payment_intent_id, s.stripe_charge_id',
    );
  });

  it('isolates order and standalone claim scopes while rejecting an invalid scope', () => {
    const { sql: migration } = readRetryHardeningMigration();
    const claim = migration.slice(
      migration.indexOf('fn_claim_checkout_recovery_shells'),
    );

    expect(claim).toContain('p_claim_scope TEXT DEFAULT NULL');
    expect(claim).toContain("p_claim_scope NOT IN ('order', 'standalone')");
    expect(claim).toContain(
      "RAISE EXCEPTION 'INVALID_CHECKOUT_RECOVERY_CLAIM_SCOPE'",
    );
    expect(claim).toContain("p_claim_scope IS NULL OR p_claim_scope = 'order'");
    expect(claim).toContain(
      "p_claim_scope IS NULL OR p_claim_scope = 'standalone'",
    );
  });

  it('replaces the stuck running flag with an expiring, service-only worker lease', () => {
    const migration = readSql(
      'supabase/migrations/20261026003552_checkout_recovery_lease.sql',
    );
    const drop = readSql(
      'supabase/migrations/20261026004335_drop_checkout_recovery_running_flag.sql',
    );
    const dropStatement =
      'ALTER TABLE public.system_settings DROP COLUMN IF EXISTS checkout_recovery_running;';

    expect(drop).toContain(dropStatement);
    expect(migration).toContain("interval '600 seconds'");
    expect(migration).toContain(
      'AND settings.checkout_recovery_enabled = true',
    );
    expect(migration).toContain(
      'AND settings.checkout_recovery_lease_id = p_lease_id',
    );
    expect(migration).toContain(
      "IF auth.role() IS DISTINCT FROM 'service_role' THEN",
    );
    for (const signature of [
      'fn_acquire_checkout_recovery_lease()',
      'fn_release_checkout_recovery_lease(UUID)',
    ]) {
      expect(migration).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`,
      );
    }
  });
});
