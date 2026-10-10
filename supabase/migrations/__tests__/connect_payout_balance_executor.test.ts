import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const readExecutorMigration = (): string => {
  const migrationFile = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('_connect_payout_balance_executor_claim.sql'))
    .sort()
    .pop();

  if (!migrationFile) {
    throw new Error('Connect payout balance executor claim migration not found');
  }

  return readFileSync(join(MIGRATIONS_DIR, migrationFile), 'utf8');
};

const findFunction = (name: string): string =>
  readExecutorMigration().match(
    new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`,
      'i',
    ),
  )?.[0] ?? '';

describe('connect payout balance executor claim migration', () => {
  test('claims only pre-payout stage runs with a pending status and no payout id', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    expect(claimRpc).not.toBe('');
    // Phase 2A compatibility: the deployed status value stays the claim gate.
    expect(claimRpc).toMatch(/status\s*=\s*'pending_reconciliation'/i);
    expect(claimRpc).toMatch(/stripe_payout_id\s+IS\s+NULL/i);
    // Stage gate: only the executor-eligible awaiting-balance stage (plus the
    // legacy NULL normalization) is claimable for payout creation.
    expect(claimRpc).toMatch(
      /release_stage\s*=\s*'awaiting_connected_balance'/i,
    );
  });

  test('claim gate requires a full transfer mapping with an active pending status', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    expect(claimRpc).toMatch(
      /NOT\s+EXISTS\s*\([\s\S]*connect_payout_run_shipments[\s\S]*JOIN\s+public\.shipments[\s\S]*m\.run_id\s*=\s*cpr\.id[\s\S]*m\.status\s*<>\s*'pending_reconciliation'\s+OR\s+s\.stripe_transfer_id\s+IS\s+NULL[\s\S]*\)/i,
    );
  });

  test('claim gate requires the seller account to be actionable', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    // Derived account actionability is consulted; unknown accounts (no
    // evidence row) default to actionable so the onboarding gate stays
    // authoritative for un-evidenced accounts.
    expect(claimRpc).toMatch(/connect_account_actionability/i);
    expect(claimRpc).toMatch(
      /COALESCE[\s\S]{0,120}?is_actionable[\s\S]{0,40}?TRUE/i,
    );
  });

  test('claim only offers next-attempt-eligible runs and never re-claims an actively leased run', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    expect(claimRpc).toMatch(
      /(?:cpr\.)?next_attempt_at\s+IS\s+NULL\s+OR\s+(?:cpr\.)?next_attempt_at\s*<=\s*now\(\)/i,
    );
    expect(claimRpc).toMatch(
      /(?:cpr\.)?payout_claim_expires_at\s+IS\s+NULL\s+OR\s+(?:cpr\.)?payout_claim_expires_at\s*<=\s*now\(\)/i,
    );
  });

  test('claim takes a short bounded lease under FOR UPDATE SKIP LOCKED', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    expect(claimRpc).toMatch(/p_lease_seconds\s+INTEGER/i);
    expect(claimRpc).toMatch(/INVALID_LEASE_SECONDS/i);
    expect(claimRpc).toMatch(/FOR\s+UPDATE\s+OF\s+cpr\s+SKIP\s+LOCKED/i);
    expect(claimRpc).toMatch(
      /now\(\)\s*\+\s*make_interval\s*\(\s*secs\s*=>\s*p_lease_seconds\s*\)/i,
    );
    expect(claimRpc).toMatch(
      /p_lease_seconds\s*<\s*1\s+OR\s+p_lease_seconds\s*>\s*900/i,
    );
  });

  test('claim persists a fresh claim token and returns it with the current stage version', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    expect(claimRpc).toMatch(
      /payout_claim_token\s*=\s*gen_random_uuid\(\)/i,
    );
    expect(claimRpc).toMatch(
      /RETURNS\s+TABLE[\s\S]*claim_token[\s\S]*stage_version/i,
    );
    // Every fence-checked write keys on the claim token, never just the lease
    // expiry.
    expect(claimRpc).toMatch(/release_stage_version/i);
  });

  test('claim orders all due candidates fairly by readiness time so deferred runs cannot starve', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    // Fair scheduling policy: every due candidate is ordered by its readiness
    // instant — a never-deferred run becomes ready at created_at, a deferred
    // run becomes ready again at next_attempt_at — so a due deferred run
    // whose backoff expired before a newer arrival is claimed ahead of it
    // under sustained arrivals. FIFO within the same readiness time; no due
    // candidate can starve behind a stream of newer arrivals.
    expect(claimRpc).toMatch(
      /ORDER\s+BY\s+COALESCE\s*\(\s*(?:cpr\.)?next_attempt_at\s*,\s*(?:cpr\.)?created_at\s*\)\s*,\s*(?:cpr\.)?created_at/i,
    );
    // The legacy NULLS FIRST ordering permanently prioritized never-deferred
    // arrivals over due deferred runs; it must not survive in the claim.
    expect(claimRpc).not.toMatch(/NULLS\s+FIRST/i);
  });

  test('the bounded backoff floor keeps a just-deferred run unclaimable in the same tick', () => {
    const deferRpc = findFunction('fn_defer_awaiting_balance_run');

    // The backoff floor is one minute: a run deferred for insufficient
    // balance sets next_attempt_at in the future, so the claim's due gate
    // excludes it for the remainder of the tick — no same-tick reclaim after
    // a deferral.
    expect(deferRpc).toMatch(
      /p_backoff_seconds\s*<\s*60\s+OR\s+p_backoff_seconds\s*>\s*3600/i,
    );
  });

  test('the create claim excludes runs fenced in payout_create_in_progress', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    // A run inside the durable write-ahead fence must never be re-claimed for
    // a second Stripe payout create; reconciliation claims it instead.
    expect(claimRpc).toMatch(/payout_create_in_progress/i);
  });

  test('every create claim mints a new fencing epoch by bumping the monotonic stage version', () => {
    const claimRpc = findFunction('fn_claim_awaiting_balance_payout_run');

    expect(claimRpc).toMatch(
      /release_stage_version\s*=\s*release_stage_version\s*\+\s*1/i,
    );
    // The bump is unconditional: gating it behind legacy normalization would
    // let a re-claimed lease reuse the previous fencing epoch, so a stale
    // worker holding the old token+version pair could still write the run.
    expect(claimRpc).not.toMatch(
      /WHEN\s+release_stage\s+IS\s+NULL\s+THEN\s+release_stage_version\s*\+/i,
    );
  });

  test('the reconciliation claim bumps the stage version so a lapsed worker cannot finish the fence', () => {
    const reconcileRpc = findFunction('fn_claim_payout_create_reconciliation');

    expect(reconcileRpc).not.toBe('');
    expect(reconcileRpc).toMatch(
      /release_stage_version\s*=\s*release_stage_version\s*\+\s*1/i,
    );
  });

  test('defer RPC applies bounded backoff and prevents same-batch reclaim', () => {
    const deferRpc = findFunction('fn_defer_awaiting_balance_run');

    expect(deferRpc).not.toBe('');
    expect(deferRpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(deferRpc).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(deferRpc).toMatch(/INVALID_BACKOFF_SECONDS/i);
    expect(deferRpc).toMatch(
      /p_backoff_seconds\s*<\s*\d+\s+OR\s+p_backoff_seconds\s*>\s*\d+/i,
    );
    // The deferral is token-conditional so a stale worker cannot defer a run a
    // newer worker already claimed.
    expect(deferRpc).toMatch(/p_claim_token/i);
    expect(deferRpc).toMatch(/next_attempt_at\s*=\s*now\(\)\s*\+\s*make_interval/i);
    expect(deferRpc).toMatch(/attempt_count\s*=\s*attempt_count\s*\+\s*1/i);
    expect(deferRpc).toMatch(/payout_claim_token\s*=\s*NULL/i);
  });

  test('reconciliation claim RPC offers only stale create-in-progress runs, never fresh ones', () => {
    const reconcileRpc = findFunction('fn_claim_payout_create_reconciliation');

    expect(reconcileRpc).not.toBe('');
    expect(reconcileRpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(reconcileRpc).toMatch(/SET\s+search_path\s*=\s*public/i);
    // Only the durable write-ahead fence stage is reconciled.
    expect(reconcileRpc).toMatch(
      /release_stage\s*=\s*'payout_create_in_progress'/i,
    );
    // The Stripe create attempt must be older than the bounded grace window so
    // an in-flight worker is never double-processed.
    expect(reconcileRpc).toMatch(
      /payout_create_attempted_at\s*<=\s*now\(\)\s*-\s*make_interval/i,
    );
    expect(reconcileRpc).toMatch(/FOR\s+UPDATE\s+OF\s+cpr\s+SKIP\s+LOCKED/i);
    // The claim mints its own fencing token for the reconciliation worker.
    expect(reconcileRpc).toMatch(/v_claim_token\s*:=\s*gen_random_uuid\(\)/i);
  });

  test('release RPC clears the claim only for the matching claim token', () => {
    const releaseRpc = findFunction('fn_release_payout_claim');

    expect(releaseRpc).not.toBe('');
    expect(releaseRpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(releaseRpc).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(releaseRpc).toMatch(
      /WHERE\s+id\s*=\s*p_run_id\s+AND[\s\S]{0,120}?payout_claim_token\s*=\s*p_claim_token/i,
    );
    expect(releaseRpc).toMatch(/payout_claim_token\s*=\s*NULL/i);
  });

  test('keeps every RPC out of public reach with service_role EXECUTE-only grants', () => {
    const sql = readExecutorMigration();

    for (const rpc of [
      'fn_claim_awaiting_balance_payout_run',
      'fn_defer_awaiting_balance_run',
      'fn_claim_payout_create_reconciliation',
      'fn_release_payout_claim',
      'fn_verify_payout_claim',
    ]) {
      const publicRevoke = sql.search(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\s+FROM\\s+PUBLIC`,
          'i',
        ),
      );
      const roleRevoke = sql.search(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\s+FROM\\s+anon,\\s*authenticated`,
          'i',
        ),
      );
      const rpcGrant = sql.search(
        new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\s+TO\\s+service_role`,
          'i',
        ),
      );

      expect(publicRevoke, `missing PUBLIC revoke for ${rpc}`).toBeGreaterThan(
        -1,
      );
      expect(roleRevoke).toBeGreaterThan(publicRevoke);
      expect(rpcGrant).toBeGreaterThan(roleRevoke);
    }
  });

  test('grants no new direct table privileges through the migration', () => {
    const sql = readExecutorMigration();

    expect(sql).not.toMatch(
      /GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE)\s+ON\s+(TABLE\s+)?public\.(connect_payout_runs|connect_payout_run_shipments|shipments)\b/i,
    );
  });

  test('does not re-add or modify the Phase 2A status contract', () => {
    const sql = readExecutorMigration();

    expect(sql).not.toMatch(
      /ALTER\s+TABLE\s+public\.connect_payout_runs[\s\S]{0,200}?status\b[\s\S]{0,200}?TYPE/i,
    );
    expect(sql).not.toMatch(/ADD\s+COLUMN[\s\S]{0,120}?\bstatus\b/i);
  });

  test('a claim-verification RPC proves token, version, and unexpired lease before Stripe calls', () => {
    const verifyRpc = findFunction('fn_verify_payout_claim');

    expect(verifyRpc).not.toBe('');
    expect(verifyRpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(verifyRpc).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(verifyRpc).toMatch(/STALE_CLAIM/i);
    expect(verifyRpc).toMatch(/CLAIM_LEASE_EXPIRED/i);
    expect(verifyRpc).toMatch(/STAGE_VERSION_CONFLICT/i);
    expect(verifyRpc).toMatch(/p_claim_token/i);
    expect(verifyRpc).toMatch(/p_expected_stage_version/i);
    expect(verifyRpc).toMatch(
      /(?:v_expires|payout_claim_expires_at)\s*<=\s*now\(\)/i,
    );
  });

  test('the defer RPC requires the expected stage version and an unexpired lease', () => {
    const deferRpc = findFunction('fn_defer_awaiting_balance_run');

    expect(deferRpc).toMatch(/p_expected_stage_version/i);
    expect(deferRpc).toMatch(
      /release_stage_version\s*=\s*p_expected_stage_version/i,
    );
    expect(deferRpc).toMatch(
      /payout_claim_expires_at\s+IS\s+NOT\s+NULL/i,
    );
    expect(deferRpc).toMatch(
      /payout_claim_expires_at\s*>\s*now\(\)/i,
    );
  });
});
