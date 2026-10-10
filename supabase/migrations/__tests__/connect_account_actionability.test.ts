import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..');

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
    .filter((name) => name.endsWith('_connect_account_current_state.sql')).sort().pop();
  return file ? readFileSync(join(MIGRATIONS_DIR, file), 'utf8') : '';
};
const currentRpc = (name: string): string => readCurrentStateMigration().match(
  new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`, 'i'),
)?.[0] ?? '';

describe('current account refresh additive migration (SQL structural only)', () => {
  test('acquisition increments the per-account generation and marks pending fail-closed', () => {
    const sql = currentRpc('fn_acquire_connect_account_refresh');
    expect(sql).toMatch(/refresh_generation\s*=\s*[^;]*refresh_generation\s*\+\s*1/i);
    expect(sql).toMatch(/refresh_pending\s*=\s*TRUE/i);
    expect(sql).toMatch(/is_actionable\s*=\s*FALSE/i);
    expect(sql).toMatch(/RETURNING\s+refresh_generation/i);
  });
  test('commit compares generation atomically before projection, with explicit refusal', () => {
    const sql = currentRpc('fn_commit_connect_account_refresh');
    expect(sql).toMatch(/p_expected_generation\s+BIGINT/i);
    expect(sql).toMatch(/UPDATE\s+public\.connect_account_actionability[\s\S]*?WHERE[\s\S]*?stripe_account_id\s*=\s*p_stripe_account_id[\s\S]*?refresh_generation\s*=\s*p_expected_generation[\s\S]*?RETURNING/i);
    expect(sql).toMatch(/IF[\s\S]*?IS\s+NULL[\s\S]*?RETURN\s+FALSE/i);
    expect(sql).toMatch(/refresh_pending\s*=\s*FALSE/i);
    expect(sql).not.toMatch(/p_stripe_created\s*[<=]/i);
  });
  test('pending or failed refresh cannot expose the previous healthy bit through the getter', () => {
    const sql = currentRpc('fn_get_connect_account_actionability');
    expect(sql).toMatch(/CASE\s+WHEN[\s\S]*?refresh_pending[\s\S]*?THEN\s+FALSE/i);
    expect(sql).toContain('account_refresh_pending');
    // Retrieval errors leave acquisition pending; only accepted CAS clears it.
    expect(currentRpc('fn_acquire_connect_account_refresh')).toMatch(/refresh_pending\s*=\s*TRUE/i);
  });
  test('snapshot provenance is separate from immutable event evidence and legacy writes are fenced', () => {
    const sql = readCurrentStateMigration();
    for (const field of ['refresh_generation', 'refresh_pending', 'current_external_account_id', 'current_observed_at']) {
      expect(sql).toContain(field);
    }
    expect(sql).not.toMatch(/UPDATE\s+public\.connect_account_events|DELETE\s+FROM\s+public\.connect_account_events/i);
    expect(currentRpc('fn_apply_connect_account_actionability')).toContain('ACCOUNT_REFRESH_REQUIRED');
  });
  test('acquire and commit are pinned SECURITY DEFINER and service-role-only', () => {
    const sql = readCurrentStateMigration();
    for (const name of ['fn_acquire_connect_account_refresh', 'fn_commit_connect_account_refresh']) {
      expect(currentRpc(name)).toMatch(/SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public/i);
      expect(sql).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}[^;]*FROM\\s+PUBLIC`, 'i'));
      expect(sql).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}[^;]*FROM\\s+anon,\\s*authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}[^;]*TO\\s+service_role`, 'i'));
    }
  });
  test('new canonical current-state SQL matches the additive deployment source', () => {
    const sql = readCurrentStateMigration();
    expect(sql.length, 'Additive migration must exist before canonical equality is meaningful').toBeGreaterThan(0);
    const canonicalPath = join(MIGRATIONS_DIR, '..', 'queries', 'payments', 'connect_account_current_state.sql');
    // No file-open RED: absent proposed canonical is represented as empty text.
    const canonical = Bun.file(canonicalPath);
    return canonical.exists().then(async (exists) => {
      expect(exists).toBe(true);
      expect(exists ? await canonical.text() : '').toBe(sql);
    });
  });
});

describe('connect account actionability migration', () => {
  test('creates a separate append-only Stripe account evidence table', () => {
    const sql = readActionabilityMigration();

    expect(sql).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.connect_account_events/i,
    );
    // Evidence identity is the Stripe event id; duplicate deliveries dedupe.
    expect(sql).toMatch(
      /stripe_event_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i,
    );
    // Append-only: updates and deletes are impossible.
    expect(sql).toMatch(
      /BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.connect_account_events/i,
    );
    expect(sql).toMatch(
      /connect_account_events\s+is\s+append-only/i,
    );
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
    expect(sql).toMatch(
      /stripe_account_id\s+TEXT\s+[^;]*PRIMARY\s+KEY/i,
    );
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

  test('blocking projects relevant pre-payout runs into action_required with the account reason', () => {
    const sql = readActionabilityMigration();

    const applyRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_apply_connect_account_actionability[\s\S]*?\$\$;/i,
    )?.[0];
    expect(applyRpc).toBeTruthy();

    // Relevant pre-payout runs of the affected Stripe account become
    // action_required with the dedicated reason; other action_required states
    // are never touched.
    expect(applyRpc).toMatch(/'account_not_actionable'/i);
    expect(applyRpc).toMatch(
      /awaiting_connected_balance[\s\S]{0,200}?transfer_created[\s\S]{0,200}?release_accepted|transfer_created[\s\S]{0,200}?awaiting_connected_balance/i,
    );
    expect(applyRpc).toMatch(/action_required_reason\s*=/i);
    // Blocked projection clears any executor claim token.
    expect(applyRpc).toMatch(/payout_claim_token\s*=\s*NULL/i);
  });

  test('a later actionable update resumes only account-actionability-blocked runs', () => {
    const sql = readActionabilityMigration();

    const applyRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_apply_connect_account_actionability[\s\S]*?\$\$;/i,
    )?.[0];
    expect(applyRpc).toBeTruthy();

    // Restore gate: only runs whose action_required state is specifically the
    // account actionability reason may resume automatically.
    expect(applyRpc).toMatch(
      /action_required_reason\s*=\s*'account_not_actionable'|action_required_reason\s+IS\s+NOT\s+DISTINCT\s+FROM\s+'account_not_actionable'/i,
    );
    // Resume lands back in the executor-eligible awaiting-balance stage and
    // clears the stored reason.
    expect(applyRpc).toMatch(/'awaiting_connected_balance'/i);
  });

  test('account evidence and actionability RPCs are idempotent by Stripe event id', () => {
    const sql = readActionabilityMigration();

    expect(sql).toMatch(
      /ON\s+CONFLICT[\s\S]{0,200}?DO\s+NOTHING/i,
    );
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

  test('keeps every new RPC service_role EXECUTE-only', () => {
    const sql = readActionabilityMigration();

    for (const rpc of [
      'fn_record_connect_account_event',
      'fn_apply_connect_account_actionability',
      'fn_get_connect_account_actionability',
      'fn_block_payout_run_for_account_actionability',
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
    expect(lookup).toMatch(/COALESCE[\s\S]{0,120}?is_actionable[\s\S]{0,40}?TRUE/i);
  });

  test('the executor account-block RPC parks a claimed run only under a live token, version, and lease', () => {
    const sql = readActionabilityMigration();
    const blockRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_block_payout_run_for_account_actionability[\s\S]*?\$\$;/i,
    )?.[0];

    expect(blockRpc).toBeTruthy();
    expect(blockRpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(blockRpc).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(blockRpc).toMatch(/p_claim_token/i);
    expect(blockRpc).toMatch(/p_expected_stage_version/i);
    expect(blockRpc).toMatch(
      /payout_claim_expires_at\s+IS\s+NOT\s+NULL[\s\S]{0,120}?payout_claim_expires_at\s*>\s*now\(\)/i,
    );
    expect(blockRpc).toMatch(/'account_not_actionable'/i);
    expect(blockRpc).toMatch(/payout_claim_token\s*=\s*NULL/i);
  });

  test('the blocked projection never parks runs fenced in payout_create_in_progress', () => {
    const sql = readActionabilityMigration();
    const applyRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_apply_connect_account_actionability[\s\S]*?\$\$;/i,
    )?.[0];
    expect(applyRpc).toBeTruthy();

    // Safe fence handling: the webhook-driven projection can never clear a
    // live claim or destroy the durable payout_create_in_progress fence; the
    // fence is exited only by its claim owner (the claim-conditional executor
    // block RPC), the reconciliation path, or a terminal projection.
    const blockedStageGate = applyRpc.match(
      /cpr\.release_stage\s+IN\s*\(([^)]*)\)/i,
    )?.[1];
    expect(blockedStageGate).toBeTruthy();
    expect(blockedStageGate).toMatch(/release_accepted/i);
    expect(blockedStageGate).toMatch(/transfer_created/i);
    expect(blockedStageGate).toMatch(/awaiting_connected_balance/i);
    expect(blockedStageGate).not.toMatch(/payout_create_in_progress/i);

    // The fence exclusion is documented in the migration itself so the
    // invariant survives review.
    expect(applyRpc).toMatch(
      /fenced\s+in\s+payout_create_in_progress[\s\S]{0,300}?never\s+parked|never\s+parked[\s\S]{0,300}?fenced\s+in\s+payout_create_in_progress/i,
    );
  });

  test('an actionable event never runs the blocked projection and only resumes exact account_not_actionable parks', () => {
    const sql = readActionabilityMigration();
    const applyRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_apply_connect_account_actionability[\s\S]*?\$\$;/i,
    )?.[0];
    expect(applyRpc).toBeTruthy();

    // Ordering: the actionable branch is decided BEFORE any run projection,
    // so a healthy event can never demote release_accepted,
    // transfer_created, awaiting_connected_balance, or the durable
    // payout_create_in_progress fence into action_required and then unfence
    // them by its own resume pass.
    const branchIdx = applyRpc.search(/IF\s+p_is_actionable\s+THEN/i);
    expect(branchIdx).toBeGreaterThan(-1);
    const runUpdates = [
      ...applyRpc.matchAll(/UPDATE\s+public\.connect_payout_runs/gi),
    ].map((match) => match.index ?? -1);
    expect(runUpdates.length).toBe(2);

    // The healthy resume and the blocked projection are the only two run
    // writes, and each lives strictly inside its own branch. The branch
    // anchors are searched AFTER the actionable IF so the function's earlier
    // validation IF/END IF blocks cannot satisfy them.
    const afterBranch = applyRpc.slice(branchIdx);
    const elseRel = afterBranch.search(/(^|\n)\s*ELSE\s*(\n|$)/m);
    expect(elseRel).toBeGreaterThan(-1);
    const elseIdx = branchIdx + elseRel;
    const afterElse = applyRpc.slice(elseIdx);
    const endIfRel = afterElse.search(/(^|\n)\s*END\s+IF;?\s*(\n|$)/m);
    expect(endIfRel).toBeGreaterThan(-1);
    const endIfIdx = elseIdx + endIfRel;
    expect(endIfIdx).toBeGreaterThan(elseIdx);
    const [resumeUpdateIdx, blockedUpdateIdx] = runUpdates;
    expect(resumeUpdateIdx).toBeGreaterThan(branchIdx);
    expect(resumeUpdateIdx).toBeLessThan(elseIdx);
    expect(blockedUpdateIdx).toBeGreaterThan(elseIdx);
    expect(blockedUpdateIdx).toBeLessThan(endIfIdx);

    // The actionable branch writes ONLY the exact resume: it matches rows
    // already parked at action_required with the dedicated reason and no
    // Stripe payout — never a fenced, progressing, terminal, or otherwise
    // action-required run.
    const resumeSection = applyRpc.slice(branchIdx, elseIdx);
    expect(resumeSection).toMatch(
      /release_stage\s*=\s*'awaiting_connected_balance'/i,
    );
    expect(resumeSection).toMatch(
      /action_required_reason\s*=\s*'account_not_actionable'/i,
    );
    expect(resumeSection).toMatch(/cpr\.release_stage\s*=\s*'action_required'/i);
    expect(resumeSection).toMatch(/cpr\.stripe_payout_id\s+IS\s+NULL/i);
  });

  test('the actionability projection is monotonic by stripe_created', () => {
    const sql = readActionabilityMigration();

    // The per-account projection stores the stripe_created of the event that
    // produced it, so ordering can be enforced across deliveries.
    const projectionTable = sql.match(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.connect_account_actionability\s*\([\s\S]*?\);/i,
    )?.[0];
    expect(projectionTable).toBeTruthy();
    expect(projectionTable).toMatch(
      /stripe_created\s+TIMESTAMPTZ\s+NOT\s+NULL/i,
    );

    const applyRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_apply_connect_account_actionability[\s\S]*?\$\$;/i,
    )?.[0];
    expect(applyRpc).toBeTruthy();

    // The projection RPC requires the signed event's stripe_created.
    expect(applyRpc).toMatch(/p_stripe_created\s+TIMESTAMPTZ/i);
    expect(applyRpc).toMatch(/MISSING_STRIPE_CREATED/i);

    // An older event can never overwrite a newer projection.
    expect(applyRpc).toMatch(
      /p_stripe_created\s*<\s*v_stored_created[\s\S]{0,200}?RETURN\s+0/i,
    );

    // A same-second restore is order-ambiguous: only a blocked state may
    // write at an equal stripe_created, never a restore.
    expect(applyRpc).toMatch(
      /p_stripe_created\s*=\s*v_stored_created\s+AND\s+p_is_actionable/i,
    );

    // The upsert persists the projection's ordering anchor.
    expect(applyRpc).toMatch(/stripe_created\s*=\s*EXCLUDED\.stripe_created/i);
  });

  test('the projection upsert is an atomic conditional write so a concurrent older event cannot overwrite a newer stripe_created state', () => {
    const sql = readActionabilityMigration();

    const applyRpc = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_apply_connect_account_actionability[\s\S]*?\$\$;/i,
    )?.[0];
    expect(applyRpc).toBeTruthy();

    // The per-account upsert must be conditional on the stored ordering
    // anchor: Postgres serializes concurrent writers on the primary-key row
    // and re-evaluates this clause against the winning row version, so an
    // older concurrent event can never overwrite a newer projection — even
    // when both deliveries race before any state is stored.
    const upsert = applyRpc?.match(
      /INSERT\s+INTO\s+public\.connect_account_actionability[\s\S]*?ON\s+CONFLICT\s+\(stripe_account_id\)\s+DO\s+UPDATE[\s\S]*?(?=RETURNING)/i,
    )?.[0];
    expect(upsert).toBeTruthy();

    // Strictly older events are refused atomically inside the write.
    expect(upsert).toMatch(
      /connect_account_actionability\.stripe_created\s*<\s*EXCLUDED\.stripe_created/i,
    );

    // At an equal stripe_created only a stricter (blocked) state may write;
    // a concurrent same-second restore never wins the race.
    expect(upsert).toMatch(
      /connect_account_actionability\.stripe_created\s*=\s*EXCLUDED\.stripe_created[\s\S]{0,200}?(EXCLUDED\.is_actionable\s*=\s*FALSE|NOT\s+EXCLUDED\.is_actionable)/i,
    );

    // A refused conditional upsert returns no row: the RPC detects it and
    // skips the run projection instead of projecting stale state.
    expect(applyRpc).toMatch(
      /RETURNING\s+stripe_account_id[\s\S]{0,120}?INTO\s+v_projected/i,
    );
    expect(applyRpc).toMatch(
      /v_projected\s+IS\s+NULL[\s\S]{0,120}?RETURN\s+0/i,
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
