import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'archive');

const readActionabilityMigration = (): string => {
  const migrationFile = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('_connect_account_actionability.sql'))
    .sort()
    .pop();

  if (!migrationFile) {
    throw new Error('Connect account actionability migration not found');
  }

  return readFileSync(join(MIGRATIONS_DIR, migrationFile), 'utf8');
};

// A1 additive current-state contract. Absence is an assertion RED, not an
// ENOENT/import failure. These tests inspect SQL text; they do NOT execute PG.
const readCurrentStateMigration = (): string => {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('_connect_account_current_state.sql'))
    .sort()
    .pop();
  return file ? readFileSync(join(MIGRATIONS_DIR, file), 'utf8') : '';
};
const currentRpc = (name: string): string =>
  readCurrentStateMigration().match(
    new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`,
      'i',
    ),
  )?.[0] ?? '';

describe('current account refresh additive migration (SQL structural only)', () => {
  test('acquisition increments the per-account generation and marks pending fail-closed', () => {
    const sql = currentRpc('fn_acquire_connect_account_refresh');
    expect(sql).toMatch(
      /refresh_generation\s*=\s*[^;]*refresh_generation\s*\+\s*1/i,
    );
    expect(sql).toMatch(/refresh_pending\s*=\s*TRUE/i);
    expect(sql).toMatch(/is_actionable\s*=\s*FALSE/i);
    expect(sql).toMatch(/RETURNING\s+refresh_generation/i);
  });
  test('commit compares generation atomically before projection, with explicit refusal', () => {
    const sql = currentRpc('fn_commit_connect_account_refresh');
    expect(sql).toMatch(/p_expected_generation\s+BIGINT/i);
    expect(sql).toMatch(
      /UPDATE\s+public\.connect_account_actionability[\s\S]*?WHERE[\s\S]*?stripe_account_id\s*=\s*p_stripe_account_id[\s\S]*?refresh_generation\s*=\s*p_expected_generation[\s\S]*?RETURNING/i,
    );
    expect(sql).toMatch(/IF[\s\S]*?IS\s+NULL[\s\S]*?RETURN\s+FALSE/i);
    expect(sql).toMatch(/refresh_pending\s*=\s*FALSE/i);
    expect(sql).not.toMatch(/p_stripe_created\s*[<=]/i);
  });
  test('pending or failed refresh cannot expose the previous healthy bit through the getter', () => {
    const sql = currentRpc('fn_get_connect_account_actionability');
    expect(sql).toMatch(
      /CASE\s+WHEN[\s\S]*?refresh_pending[\s\S]*?THEN\s+FALSE/i,
    );
    expect(sql).toContain('account_refresh_pending');
    // Retrieval errors leave acquisition pending; only accepted CAS clears it.
    expect(currentRpc('fn_acquire_connect_account_refresh')).toMatch(
      /refresh_pending\s*=\s*TRUE/i,
    );
  });
  test('snapshot provenance is separate from immutable event evidence and legacy writes are fenced', () => {
    const sql = readCurrentStateMigration();
    for (const field of [
      'refresh_generation',
      'refresh_pending',
      'current_external_account_id',
      'current_observed_at',
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).not.toMatch(
      /UPDATE\s+public\.connect_account_events|DELETE\s+FROM\s+public\.connect_account_events/i,
    );
    expect(currentRpc('fn_apply_connect_account_actionability')).toContain(
      'ACCOUNT_REFRESH_REQUIRED',
    );
  });
  test('acquire and commit are pinned SECURITY DEFINER and service-role-only', () => {
    const sql = readCurrentStateMigration();
    for (const name of [
      'fn_acquire_connect_account_refresh',
      'fn_commit_connect_account_refresh',
    ]) {
      expect(currentRpc(name)).toMatch(
        /SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public/i,
      );
      expect(sql).toMatch(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}[^;]*FROM\\s+PUBLIC`,
          'i',
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}[^;]*FROM\\s+anon,\\s*authenticated`,
          'i',
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}[^;]*TO\\s+service_role`,
          'i',
        ),
      );
    }
  });
});

describe('connect account actionability migration', () => {
  test('creates a separate append-only Stripe account evidence table', () => {
    const sql = readActionabilityMigration();

    expect(sql).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.connect_account_events/i,
    );
    // Evidence identity is the Stripe event id; duplicate deliveries dedupe.
    expect(sql).toMatch(/stripe_event_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
    // Append-only: updates and deletes are impossible.
    expect(sql).toMatch(
      /BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.connect_account_events/i,
    );
    expect(sql).toMatch(/connect_account_events\s+is\s+append-only/i);
    // RLS as defense in depth, and never a Phase 2A ledger mutation: the
    // evidence table must not touch connect_payout_events or payout runs.
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+public\.connect_account_events\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
  });

  test('persists derived actionability by Stripe account', () => {
    const sql = readActionabilityMigration();

    expect(sql).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.connect_account_actionability/i,
    );
    expect(sql).toMatch(/stripe_account_id\s+TEXT\s+[^;]*PRIMARY\s+KEY/i);
    expect(sql).toMatch(/is_actionable\s+BOOLEAN/i);
    expect(sql).toMatch(/blocked_reason\s+TEXT/i);
  });

  test('treats the documented non-actionable external-account statuses as blocked', () => {
    const sql = readActionabilityMigration();

    for (const status of [
      'errored',
      'verification_failed',
      'tokenized_account_number_deactivated',
    ]) {
      expect(sql, `blocked status ${status}`).toMatch(
        new RegExp(`'${status}'`),
      );
    }
  });

  test('evidence append RPC is SECURITY DEFINER with pinned search_path', () => {
    const sql = readActionabilityMigration();

    const recordRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_record_connect_account_event[\s\S]*?\$\$;/i,
    )?.[0];
    expect(recordRpc).toBeTruthy();
    expect(recordRpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(recordRpc).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  test('grants no direct table privileges on the new tables', () => {
    const sql = readActionabilityMigration();

    expect(sql).not.toMatch(
      /GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE)\s+ON\s+(TABLE\s+)?public\.(connect_account_events|connect_account_actionability)\b/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.connect_account_events\s+FROM\s+PUBLIC/i,
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.connect_account_actionability\s+FROM\s+PUBLIC/i,
    );
  });

  test('offers an RPC-only actionability lookup so the worker never reads a revoked table', () => {
    const sql = readActionabilityMigration();
    const lookup = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_get_connect_account_actionability[\s\S]*?\$\$;/i,
    )?.[0];

    expect(lookup).toBeTruthy();
    expect(lookup).toMatch(/SECURITY\s+DEFINER/i);
    expect(lookup).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(lookup).toMatch(
      /RETURNS\s+TABLE[\s\S]*?is_actionable[\s\S]*?blocked_reason/i,
    );
    // Unevidenced accounts default to actionable inside the lookup too.
    expect(lookup).toMatch(
      /COALESCE[\s\S]{0,120}?is_actionable[\s\S]{0,40}?TRUE/i,
    );
  });

  test('account evidence records the external bank account id', () => {
    const sql = readActionabilityMigration();

    const evidenceTable = sql.match(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.connect_account_events\s*\([\s\S]*?\);/i,
    )?.[0];
    expect(evidenceTable).toBeTruthy();
    expect(evidenceTable).toMatch(/external_account_id\s+TEXT/i);

    const recordRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_record_connect_account_event[\s\S]*?\$\$;/i,
    )?.[0];
    expect(recordRpc).toBeTruthy();
    expect(recordRpc).toMatch(/p_external_account_id\s+TEXT/i);
    expect(recordRpc).toMatch(
      /INSERT\s+INTO[\s\S]*?external_account_id[\s\S]*?VALUES[\s\S]*?p_external_account_id/i,
    );
  });
});
