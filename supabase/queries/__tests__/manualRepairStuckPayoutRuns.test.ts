// source-text: an operator runbook that never runs in tests; its rollback-first wording and filters are the contract
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/queries/payments/manual_repair_connect_payout_stuck_runs.sql',
  ),
  'utf8',
).replace(/\s+/g, ' ');

describe('manual repair of stuck Connect payout runs', () => {
  it('documents a rollback-first manual repair for verified no-payout stuck Connect runs', () => {
    expect(sql).toContain(
      'Do not mark a run failed until an operator confirms in Stripe that no payout',
    );
    expect(sql).toContain(
      'CREATE TEMP TABLE verified_no_stripe_payout_run_ids',
    );
    expect(sql).toContain('cpr.stripe_payout_id IS NULL');
    expect(sql).toContain(
      "cpr.status IN ('pending_reconciliation', 'reconciliation_needed')",
    );
    expect(sql).toContain(
      "crs.status IN ('pending_reconciliation', 'reconciliation_needed')",
    );
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain('ROLLBACK;');
    expect(sql).toContain('Replace ROLLBACK with COMMIT only after');
  });
});
