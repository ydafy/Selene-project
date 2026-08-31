import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSql = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8').replace(/\s+/g, ' ');

const readRetryHardeningMigration = () => {
  const migrationFile = readdirSync(join(process.cwd(), 'supabase/migrations')).find(
    (file) => file.endsWith('_standalone_recovery_retry_hardening.sql'),
  );

  return {
    migrationFile,
    sql: migrationFile ? readSql(`supabase/migrations/${migrationFile}`) : '',
  };
};

const readOperationalControlMigration = () => {
  const migrationFile = readdirSync(join(process.cwd(), 'supabase/migrations')).find(
    (file) => file.endsWith('_checkout_recovery_worker_operational_control.sql'),
  );

  return {
    migrationFile,
    sql: migrationFile ? readSql(`supabase/migrations/${migrationFile}`) : '',
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

  it('declares the standalone charge evidence column in canonical SQL', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');

    expect(sql).toContain(
      'ALTER TABLE public.checkout_recovery_shells ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT',
    );
  });

  it('persists first-known charge evidence and terminalizes missing evidence for reconciliation', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const { sql: migration } = readRetryHardeningMigration();

    for (const source of [sql, migration]) {
      expect(source).toContain('fn_set_checkout_recovery_charge_evidence');
      expect(source).toContain(
        'stripe_charge_id = COALESCE(stripe_charge_id, p_stripe_charge_id)',
      );
      expect(source).toContain(
        'fn_mark_checkout_recovery_reconciliation_needed',
      );
      expect(source).toContain("compensation_state = 'reconciliation_needed'");
      expect(source).toContain('compensation_lease_expires_at = NULL');
      expect(source).toContain('next_compensation_retry_at = NULL');
    }
  });

  it('claims only eligible shells with a non-blocking row lock', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');

    expect(sql).toContain('fn_claim_checkout_recovery_shells');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("compensation_state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding')");
    expect(sql).toContain("payment_processing = true");
    expect(sql).toContain("created_at <= now() - interval '5 minutes'");
  });

  it('makes a named webhook claim eligible immediately while keeping the five-minute delay for cron claims', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');

    expect(sql).toContain('p_stripe_payment_intent_id IS NOT NULL');
    expect(sql).toContain("o.compensation_state = 'refund_pending'");
    expect(sql).toContain("o.next_compensation_retry_at <= now()");
  });

  it('finalizes only after a confirmed refund by locking the order before reserved products', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const finalizeStart = sql.indexOf('fn_finalize_checkout_recovery');
    const finalize = sql.slice(finalizeStart);

    const orderLock = finalize.indexOf('FROM public.orders');
    const productLock = finalize.indexOf('FROM public.products');
    const finalStatus = finalize.indexOf("status = 'refunded'", productLock);

    expect(orderLock).toBeGreaterThan(-1);
    expect(productLock).toBeGreaterThan(orderLock);
    expect(finalStatus).toBeGreaterThan(productLock);
    expect(finalize).toContain("status = 'RESERVED'");
    expect(finalize).toContain("status = 'VERIFIED'");
    expect(finalize).toContain("compensation_state = 'refunded'");
    expect(finalize).toContain('p_stripe_refund_id');
  });

  it('fully releases the reservation timestamp when finalization returns a product to VERIFIED', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const finalize = sql.slice(sql.indexOf('fn_finalize_checkout_recovery'));

    expect(finalize).toContain(
      "SET status = 'VERIFIED', reserved_at = NULL, updated_at = now()",
    );
  });

  it('keeps an already-refunded order unchanged when a duplicate webhook upserts a shell', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const upsertStart = sql.indexOf('fn_upsert_checkout_recovery_shell');
    const claimStart = sql.indexOf('fn_claim_checkout_recovery_shells');
    const upsert = sql.slice(upsertStart, claimStart);

    expect(upsert).toContain("AND status <> 'refunded'");
  });

  it('terminalizes a standalone shell when a duplicate webhook finds a refunded order', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const upsertStart = sql.indexOf('fn_upsert_checkout_recovery_shell');
    const claimStart = sql.indexOf('fn_claim_checkout_recovery_shells');
    const upsert = sql.slice(upsertStart, claimStart);
    const refundedOrder = upsert.indexOf("AND status = 'refunded'");
    const terminalShell = upsert.indexOf(
      "SET compensation_state = 'refunded'",
      refundedOrder,
    );
    const duplicate = upsert.indexOf("'status', 'duplicate'", terminalShell);

    expect(refundedOrder).toBeGreaterThan(-1);
    expect(terminalShell).toBeGreaterThan(refundedOrder);
    expect(duplicate).toBeGreaterThan(terminalShell);
    expect(upsert).toContain('compensation_lease_expires_at = NULL');
    expect(upsert).toContain('next_compensation_retry_at = NULL');
  });

  it('terminalizes a legacy standalone shell before finalization returns an order duplicate', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const finalizeStart = sql.indexOf('fn_finalize_checkout_recovery');
    const finalize = sql.slice(finalizeStart);
    const refundedOrder = finalize.indexOf(
      "WHERE id = v_order_id AND compensation_state = 'refunded'",
    );
    const terminalShell = finalize.indexOf(
      'UPDATE public.checkout_recovery_shells',
      refundedOrder,
    );
    const duplicate = finalize.indexOf("'status', 'duplicate'", terminalShell);

    expect(refundedOrder).toBeGreaterThan(-1);
    expect(terminalShell).toBeGreaterThan(refundedOrder);
    expect(duplicate).toBeGreaterThan(terminalShell);
  });

  it('persists malformed or legacy charged metadata in a standalone shell when no order exists', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const migration = readSql('supabase/migrations/20260826045628_paid_checkout_recovery.sql');
    const upsertStart = sql.indexOf('fn_upsert_checkout_recovery_shell');
    const claimStart = sql.indexOf('fn_claim_checkout_recovery_shells');
    const upsert = sql.slice(upsertStart, claimStart);

    expect(upsert).toContain('p_source_metadata JSONB');
    expect(upsert).toContain('p_charged_amount_cents BIGINT');
    expect(upsert).toContain('INSERT INTO public.checkout_recovery_shells');
    expect(upsert).toContain("'target', 'standalone_recovery_shell'");
    expect(sql).toContain('FROM public.checkout_recovery_shells s');
    expect(sql).toContain('UPDATE public.checkout_recovery_shells');
    expect(sql).toContain("'status', 'refunded', 'stripe_payment_intent_id'");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.checkout_recovery_shells');
    expect(migration).toContain('stripe_payment_intent_id TEXT PRIMARY KEY');
  });

  it('persists the first standalone charge id and returns it from standalone claims', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const { migrationFile, sql: migration } = readRetryHardeningMigration();

    expect(migrationFile).toBeDefined();
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT');
    expect(migration).toContain('p_stripe_charge_id TEXT DEFAULT NULL');
    expect(migration).toContain(
      'stripe_charge_id = COALESCE(public.checkout_recovery_shells.stripe_charge_id, EXCLUDED.stripe_charge_id)',
    );
    expect(migration).toContain('RETURNING s.stripe_payment_intent_id, s.stripe_charge_id');
    expect(sql).toContain('p_stripe_charge_id TEXT DEFAULT NULL');
    expect(sql).toContain(
      'stripe_charge_id = COALESCE(public.checkout_recovery_shells.stripe_charge_id, EXCLUDED.stripe_charge_id)',
    );
    expect(sql).toContain('RETURNING s.stripe_payment_intent_id, s.stripe_charge_id');
  });

  it('isolates order and standalone claim scopes while rejecting an invalid scope', () => {
    const sql = readSql('supabase/queries/orders/checkout_recovery.sql');
    const { sql: migration } = readRetryHardeningMigration();

    for (const source of [sql, migration]) {
      const claim = source.slice(source.indexOf('fn_claim_checkout_recovery_shells'));

      expect(claim).toContain('p_claim_scope TEXT DEFAULT NULL');
      expect(claim).toContain("p_claim_scope NOT IN ('order', 'standalone')");
      expect(claim).toContain("RAISE EXCEPTION 'INVALID_CHECKOUT_RECOVERY_CLAIM_SCOPE'");
      expect(claim).toContain("p_claim_scope IS NULL OR p_claim_scope = 'order'");
      expect(claim).toContain("p_claim_scope IS NULL OR p_claim_scope = 'standalone'");
    }
  });
});
