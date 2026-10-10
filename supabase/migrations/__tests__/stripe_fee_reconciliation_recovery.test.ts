import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..');
const JOB_TABLE = 'stripe_fee_reconciliation_jobs';

const readMigrations = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));

const findReconciliationJobMigration = (): string => {
  const migration = readMigrations().find((sql) =>
    new RegExp(
      `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+public\\.${JOB_TABLE}\\b`,
      'i',
    ).test(sql),
  );

  if (!migration) {
    throw new Error(
      `Dedicated ${JOB_TABLE} migration not found; generic webhook_dlq state is not an acceptable financial job ledger`,
    );
  }

  return migration;
};

const findRpc = (name: string): string =>
  readMigrations()
    .join('\n\n')
    .match(
      new RegExp(
        `CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`,
        'i',
      ),
    )?.[0] ?? '';

// Historical migration characterization. Current lease/cutover contracts are
// asserted separately in stripe_fee_reconciliation_lease.test.ts.
describe('historical deferred Stripe fee reconciliation migrations', () => {
  test('defines an idempotent, retryable, server-only financial job ledger', () => {
    const sql = findReconciliationJobMigration();

    expect(sql).toMatch(/order_id\s+UUID\s+NOT\s+NULL/i);
    expect(sql).toMatch(/stripe_payment_intent_id\s+TEXT\s+NOT\s+NULL/i);
    expect(
      /UNIQUE\s*\(\s*order_id\s*,\s*stripe_payment_intent_id\s*\)/i.test(
        sql,
      ) ||
        new RegExp(
          `CREATE\\s+UNIQUE\\s+INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?[\\s\\S]+?ON\\s+public\\.${JOB_TABLE}\\s*\\(\\s*order_id\\s*,\\s*stripe_payment_intent_id\\s*\\)`,
          'i',
        ).test(sql),
    ).toBe(true);

    expect(sql).toMatch(/status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i);
    expect(sql).toMatch(
      /CHECK\s*\(\s*status\s+IN\s*\(\s*'pending'\s*,\s*'processing'\s*,\s*'succeeded'\s*,\s*'failed'\s*\)\s*\)/i,
    );
    expect(sql).toMatch(/attempt_count\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i);
    expect(sql).toMatch(/next_retry_at\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/last_error\s+TEXT/i);

    expect(sql).toMatch(
      new RegExp(
        `ALTER\\s+TABLE\\s+public\\.${JOB_TABLE}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i',
      ),
    );
    expect(sql).toMatch(
      new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+(?:TABLE\\s+)?public\\.${JOB_TABLE}\\s+FROM\\s+(?=[^;]*\\bPUBLIC\\b)(?=[^;]*\\banon\\b)(?=[^;]*\\bauthenticated\\b)[^;]+;`,
        'i',
      ),
    );
    expect(sql).toMatch(
      new RegExp(
        `GRANT\\s+(?:ALL|SELECT\\s*,\\s*INSERT\\s*,\\s*UPDATE\\s*,\\s*DELETE)\\s+ON\\s+(?:TABLE\\s+)?public\\.${JOB_TABLE}\\s+TO\\s+service_role`,
        'i',
      ),
    );
  });

  test('claims due pending jobs atomically in a bounded batch', () => {
    const claimRpc = findRpc('fn_claim_stripe_fee_reconciliation_jobs');

    expect(claimRpc).not.toBe('');
    expect(claimRpc).toMatch(/p_limit\s+INTEGER/i);
    expect(claimRpc).toMatch(/status\s*=\s*'pending'/i);
    expect(claimRpc).toMatch(/next_retry_at\s+IS\s+NULL/i);
    expect(claimRpc).toMatch(/next_retry_at\s*<=\s*now\(\)/i);
    expect(claimRpc).toMatch(/FOR\s+UPDATE\s+SKIP\s+LOCKED/i);
    expect(claimRpc).toMatch(
      /LIMIT\s+GREATEST\s*\(\s*1\s*,\s*LEAST\s*\(\s*p_limit\s*,\s*100\s*\)\s*\)/i,
    );
    expect(claimRpc).toMatch(
      /UPDATE\s+public\.stripe_fee_reconciliation_jobs[\s\S]*?SET[\s\S]*?status\s*=\s*'processing'[\s\S]*?attempt_count\s*=\s*[^;]*attempt_count\s*\+\s*1[\s\S]*?RETURNING/i,
    );
  });

  test('transitions only claimed jobs to succeeded, retry, or failed', () => {
    const transitionRpc = findRpc(
      'fn_transition_stripe_fee_reconciliation_job',
    );

    expect(transitionRpc).not.toBe('');
    expect(transitionRpc).toMatch(
      /p_outcome\s+NOT\s+IN\s*\(\s*'succeeded'\s*,\s*'retry'\s*,\s*'failed'\s*\)/i,
    );
    expect(transitionRpc).toMatch(
      /status\s*=\s*CASE\s+p_outcome\s+WHEN\s+'succeeded'\s+THEN\s+'succeeded'\s+WHEN\s+'retry'\s+THEN\s+'pending'\s+WHEN\s+'failed'\s+THEN\s+'failed'\s+END/i,
    );
    expect(transitionRpc).toMatch(
      /WHERE[\s\S]*?id\s*=\s*p_job_id[\s\S]*?status\s*=\s*'processing'/i,
    );
    expect(transitionRpc).toMatch(
      /IF\s+NOT\s+FOUND[\s\S]*?RAISE\s+EXCEPTION/i,
    );
  });

  test('persists the fee and completes its claimed job in one transaction', () => {
    const completionRpc = findRpc(
      'fn_complete_stripe_fee_reconciliation_job',
    );

    expect(completionRpc).not.toBe('');
    expect(completionRpc).toMatch(/p_job_id\s+UUID/i);
    expect(completionRpc).toMatch(/p_actual_stripe_fee_cents\s+BIGINT/i);
    expect(completionRpc).toMatch(/p_reconciled_at\s+TIMESTAMPTZ/i);
    expect(completionRpc).toMatch(
      new RegExp(
        `SELECT[\\s\\S]+?FROM\\s+public\\.${JOB_TABLE}[\\s\\S]+?WHERE[\\s\\S]+?id\\s*=\\s*p_job_id[\\s\\S]+?status\\s*=\\s*'processing'[\\s\\S]+?FOR\\s+UPDATE`,
        'i',
      ),
    );
    expect(completionRpc).toMatch(
      /UPDATE\s+public\.orders[\s\S]+?SET[\s\S]+?actual_stripe_fee_cents\s*=\s*p_actual_stripe_fee_cents[\s\S]+?stripe_fee_reconciled_at\s*=\s*p_reconciled_at[\s\S]+?WHERE[\s\S]+?actual_stripe_fee_cents\s+IS\s+NULL/i,
    );
    expect(completionRpc).toMatch(
      new RegExp(
        `UPDATE\\s+public\\.${JOB_TABLE}[\\s\\S]+?SET[\\s\\S]+?status\\s*=\\s*'succeeded'[\\s\\S]+?WHERE[\\s\\S]+?id\\s*=\\s*p_job_id[\\s\\S]+?status\\s*=\\s*'processing'`,
        'i',
      ),
    );
    expect(completionRpc).toMatch(
      /IF\s+NOT\s+FOUND[\s\S]*?RAISE\s+EXCEPTION/i,
    );
  });

  test('keeps reconciliation job RPCs private to service_role', () => {
    const sql = readMigrations().join('\n\n');
    const rpcNames = [
      'fn_claim_stripe_fee_reconciliation_jobs',
      'fn_transition_stripe_fee_reconciliation_job',
      'fn_complete_stripe_fee_reconciliation_job',
    ];

    for (const name of rpcNames) {
      const rpc = findRpc(name);

      expect(rpc).toContain('SECURITY DEFINER');
      expect(rpc).toMatch(/SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
      expect(rpc).toContain("auth.role() IS DISTINCT FROM 'service_role'");
      expect(sql).toMatch(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\([^;]*?\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`,
          'i',
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\([^;]*?\\)\\s+TO\\s+service_role`,
          'i',
        ),
      );
    }
  });
});
