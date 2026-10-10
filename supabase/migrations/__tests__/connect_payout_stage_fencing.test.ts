import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dir, '..');

const readStageFencingMigration = (): string => {
  const migrationFile = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('_connect_payout_stage_fencing.sql'))
    .sort()
    .pop();

  if (!migrationFile) {
    throw new Error('Connect payout stage fencing migration not found');
  }

  return readFileSync(join(MIGRATIONS_DIR, migrationFile), 'utf8');
};

const getSignature = (sql: string, name: string): string =>
  sql.match(
    new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\b\\s*\\(([\\s\\S]*?)\\)\\s*RETURNS`,
      'i',
    ),
  )?.[1] ?? '';

const findFunction = (sql: string, name: string): string =>
  sql.match(
    new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`,
      'i',
    ),
  )?.[0] ?? '';

// T4 structural contract only: these assertions inspect repository SQL, not
// PostgreSQL execution or the historical incident's unproven interleaving.
describe('complete failed terminal replay SQL contract (not DB execution)', () => {
  const canonicalDir = join(MIGRATIONS_DIR, '..', 'queries', 'payments');
  const sources = {
    standalone: readFileSync(join(canonicalDir, 'fn_project_payout_run_terminal.sql'), 'utf8'),
    combined: [...readFileSync(join(canonicalDir, 'connect_payout_stage_fencing.sql'), 'utf8')
      .matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_project_payout_run_terminal\b[\s\S]*?\$\$;/gi)].at(-1)?.[0] ?? '',
  };
  for (const [name, rpc] of Object.entries(sources)) {
    test(`${name}: complete same-payout failed replay returns true before any writes`, () => {
      const beforeWrites = rpc.split(/UPDATE\s+public\.connect_payout_runs/i)[0];
      const branch = beforeWrites.match(/IF\s+v_status\s*=\s*'failed'\s+AND\s+p_target_status\s*=\s*'failed'\s+THEN([\s\S]*?)RETURN\s+TRUE;\s*END\s+IF;/i)?.[1] ?? '';
      expect(branch, 'Missing locked complete failed no-op; current update excludes failed runs').not.toBe('');
      expect(beforeWrites).toMatch(/cpr\.stripe_payout_id\s*=\s*p_payout_id[\s\S]*?FOR\s+UPDATE/i);
      expect(beforeWrites).toMatch(/cpr\.failed_at/i);
      expect(branch).toMatch(/v_stage\s+IS\s+DISTINCT\s+FROM\s+'payout_failed'/i);
      expect(branch).toMatch(/v_failed_at\s+IS\s+NULL/i);
      expect(branch).toMatch(/v_claim_token\s+IS\s+NOT\s+NULL/i);
      expect(branch).toMatch(/v_claim_expires_at\s+IS\s+NOT\s+NULL/i);
      expect(branch).toMatch(/NOT\s+EXISTS\s*\([\s\S]*?m\.run_id\s*=\s*p_run_id/i);
      expect(branch).toMatch(/m\.shipment_id\s+IS\s+NULL/i);
      expect(branch).toMatch(/m\.status\s+IS\s+DISTINCT\s+FROM\s+'failed'/i);
      expect(branch).toMatch(/s\.id\s+IS\s+NULL/i);
      expect(branch).toMatch(/s\.stripe_payout_id\s+IS\s+NOT\s+NULL/i);
      expect(branch).toMatch(/RETURN\s+FALSE/i);
      // Returning before writes preserves original failed_at/failure_reason,
      // stage version and mappings, including a later retry child's markings.
      expect(branch).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/i);
    });
    test(`${name}: identity, paid reversal and run-scoped clearing controls remain`, () => {
      expect(rpc).toMatch(/cpr\.id\s*=\s*p_run_id\s+AND\s+cpr\.stripe_payout_id\s*=\s*p_payout_id/i);
      expect(rpc).toMatch(/v_status\s*=\s*'paid'\s+AND\s+p_target_status\s*=\s*'failed'/i);
      expect(rpc).toMatch(/p_occurred_at\s*<\s*v_paid_at/i);
      expect(rpc).toMatch(/SET\s+stripe_payout_id\s*=\s*NULL[\s\S]*?m\.run_id\s*=\s*p_run_id[\s\S]*?AND\s+stripe_payout_id\s*=\s*p_payout_id/i);
    });
  }
});

const FENCE_COLUMNS = [
  'release_stage',
  'release_stage_version',
  'payout_claim_token',
  'payout_claim_expires_at',
  'payout_create_attempted_at',
  'next_attempt_at',
  'attempt_count',
  'last_error',
  'action_required_reason',
];

describe('additive terminal projection migration', () => {
  const path = join(MIGRATIONS_DIR, '20260923000000_idempotent_connect_payout_terminal_projection.sql');
  test('replaces only the terminal RPC with locked, complete paid equivalence', () => {
    const sql = readFileSync(path, 'utf8');
    const rpc = findFunction(sql, 'fn_project_payout_run_terminal');
    expect(rpc).not.toBe('');
    expect(sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION/gi)).toHaveLength(1);
    expect(rpc).toMatch(/FOR\s+UPDATE/i);
    expect(rpc).toMatch(/v_status\s*=\s*'paid'\s+AND\s+p_target_status\s*=\s*'paid'/i);
    expect(rpc).toMatch(/v_stage\s+IS\s+DISTINCT\s+FROM\s+'paid_observed'/i);
    expect(rpc).toMatch(/v_paid_at\s+IS\s+NULL/i);
    expect(rpc).toMatch(/NOT\s+EXISTS\s*\([\s\S]*?m\.status\s+IS\s+DISTINCT\s+FROM\s+'paid'/i);
    expect(rpc).toMatch(/s\.stripe_payout_id\s+IS\s+DISTINCT\s+FROM\s+p_payout_id/i);
    expect(rpc).toMatch(/RETURN\s+TRUE/i);
    expect(rpc).toMatch(/status\s*=\s*'paid'\s+AND\s+p_target_status\s*=\s*'failed'/i);
    expect(rpc).toMatch(/SHIPMENT_ALREADY_RELEASED/i);
    expect(rpc).toMatch(/SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_project_payout_run_terminal FROM PUBLIC;/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_project_payout_run_terminal FROM anon, authenticated;/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_project_payout_run_terminal TO service_role;/i);
  });

  test('canonical operational SQL ends with the same terminal function as the additive migration', () => {
    const migration = readFileSync(join(MIGRATIONS_DIR, '20261001070000_idempotent_failed_payout_terminal_projection.sql'), 'utf8');
    const canonical = readFileSync(
      join(MIGRATIONS_DIR, '..', 'queries', 'payments', 'connect_payout_stage_fencing.sql'),
      'utf8',
    );
    const name = 'fn_project_payout_run_terminal';
    const terminalDefinitions = [
      ...canonical.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_project_payout_run_terminal\b[\s\S]*?\$\$;/gi),
    ];
    expect(terminalDefinitions.length).toBeGreaterThan(0);
    expect(terminalDefinitions.at(-1)?.[0]).toBe(findFunction(migration, name));
  });

  test('mismatched payout, incomplete mappings and late paid-to-failed remain distinct outcomes', () => {
    const rpc = findFunction(readFileSync(path, 'utf8'), 'fn_project_payout_run_terminal');
    const lock = rpc.match(/SELECT\s+cpr\.status[\s\S]*?FOR\s+UPDATE\s*;/i)?.[0] ?? '';
    expect(lock).toMatch(/cpr\.id\s*=\s*p_run_id\s+AND\s+cpr\.stripe_payout_id\s*=\s*p_payout_id/i);
    const noOp = rpc.match(/IF\s+v_status\s*=\s*'paid'\s+AND\s+p_target_status\s*=\s*'paid'\s+THEN([\s\S]*?)\n\s*END\s+IF;/i)?.[1] ?? '';
    expect(noOp).toMatch(/v_stage\s+IS\s+DISTINCT\s+FROM\s+'paid_observed'/i);
    expect(noOp).toMatch(/v_claim_token\s+IS\s+NOT\s+NULL/i);
    expect(noOp).toMatch(/v_claim_expires_at\s+IS\s+NOT\s+NULL/i);
    expect(noOp).toMatch(/v_paid_at\s+IS\s+NULL/i);
    expect(noOp).toMatch(/NOT\s+EXISTS\s*\([\s\S]*?m\.run_id\s*=\s*p_run_id/i);
    expect(noOp).toMatch(/m\.shipment_id\s+IS\s+NULL/i);
    expect(noOp).toMatch(/m\.status\s+IS\s+DISTINCT\s+FROM\s+'paid'/i);
    expect(noOp).toMatch(/s\.id\s+IS\s+NULL/i);
    expect(noOp).toMatch(/s\.stripe_payout_id\s+IS\s+DISTINCT\s+FROM\s+p_payout_id/i);
    expect(noOp).toMatch(/THEN\s+RETURN\s+FALSE;/i);
    expect(rpc).toMatch(/END\s+IF;\s+RETURN\s+TRUE;\s+END\s+IF;[\s\S]*?IF v_status = 'paid' AND p_target_status = 'failed' THEN[\s\S]*?END IF;\s+UPDATE\s+public\.connect_payout_runs/i);
    expect(rpc).toMatch(/status\s*=\s*'paid'\s+AND\s+p_target_status\s*=\s*'failed'/i);
    expect(rpc).toMatch(/SET\s+stripe_payout_id\s*=\s*NULL[\s\S]*?AND\s+stripe_payout_id\s*=\s*p_payout_id/i);
    expect(rpc).toMatch(/AND\s+NOT\s*\(p_target_status\s*=\s*'paid'\s+AND\s+status\s+IN\s*\('failed',\s*'canceled'\)\)/i);
  });

  test('locked paid timestamp refuses stale failed downgrades without bypassing later failure', () => {
    const rpc = findFunction(readFileSync(path, 'utf8'), 'fn_project_payout_run_terminal');
    const gate = rpc.match(/IF v_status = 'paid' AND p_target_status = 'failed' THEN([\s\S]*?)END IF;/i)?.[1] ?? '';
    expect(gate).toMatch(/v_paid_at IS NULL/i);
    expect(gate).toMatch(/p_occurred_at IS NULL/i);
    expect(gate).toMatch(/p_occurred_at < v_paid_at/i);
    expect(gate).toMatch(/RETURN FALSE/i);
    expect(rpc).toMatch(/status = 'paid' AND p_target_status = 'failed'/i);
    expect(rpc).toMatch(/IF NOT COALESCE\(v_updated, FALSE\) THEN\s+RETURN FALSE;/i);
  });

  test('initial paid projection rejects missing or terminal mappings atomically', () => {
    const rpc = findFunction(readFileSync(path, 'utf8'), 'fn_project_payout_run_terminal');
    const paid = rpc.match(/IF p_target_status = 'paid' THEN\s+IF NOT EXISTS[\s\S]*?ELSE\s+UPDATE public\.shipments/i)?.[0] ?? '';
    expect(paid).toMatch(/LEFT JOIN public\.shipments s ON s\.id = m\.shipment_id/i);
    expect(paid).toMatch(/m\.status IS DISTINCT FROM 'paid'/i);
    expect(paid).toMatch(/s\.id IS NULL/i);
    expect(paid).toMatch(/s\.stripe_payout_id IS DISTINCT FROM p_payout_id/i);
    expect(paid).toMatch(/RAISE EXCEPTION 'PAYOUT_MAPPING_INCOMPLETE/i);
    expect(rpc).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
  });
});

describe('late progress after terminal additive override', () => {
  test('accepts only locked complete same-payout paid projections and refuses mismatches', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((file) =>
      /^\d+_.*late_payout_progress.*\.sql$/.test(file),
    );
    expect(files, 'T2 must add a NEW migration; never rewrite the deployed stage migration').toHaveLength(1);
    const sql = readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
    const rpc = findFunction(sql, 'fn_project_payout_run_stage');
    expect(rpc).not.toBe('');
    const lock = rpc.match(/SELECT[\s\S]*?FOR\s+UPDATE\s*;/i)?.[0] ?? '';
    expect(lock).toMatch(/stripe_payout_id/i);
    expect(lock).toMatch(/paid_at/i);
    expect(lock).toMatch(/cpr\.stripe_payout_id\s*=\s*p_payout_id/i);
    expect(rpc).toMatch(/v_status\s*=\s*'paid'[\s\S]*?v_stage\s+IS\s+DISTINCT\s+FROM\s+'paid_observed'/i);
    expect(rpc).toMatch(/v_payout_id\s+IS\s+DISTINCT\s+FROM\s+p_payout_id/i);
    expect(rpc).toMatch(/v_paid_at\s+IS\s+NULL/i);
    expect(rpc).toMatch(/NOT\s+EXISTS\s*\([\s\S]*?m\.status\s+IS\s+DISTINCT\s+FROM\s+'paid'/i);
    expect(rpc).toMatch(/s\.stripe_payout_id\s+IS\s+DISTINCT\s+FROM\s+v_payout_id/i);
    expect(rpc).toMatch(/RETURN\s+FALSE[\s\S]*?RETURN\s+TRUE/i);
    expect(rpc).toMatch(/SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_project_payout_run_stage FROM PUBLIC;/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_project_payout_run_stage FROM anon, authenticated;/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_project_payout_run_stage TO service_role;/i);
    const paidBranch = rpc.match(/IF v_status = 'paid' THEN([\s\S]*?)END IF;/i)?.[1] ?? '';
    expect(paidBranch).toMatch(/v_stage IS DISTINCT FROM 'paid_observed'/i);
    expect(paidBranch).toMatch(/v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL/i);
    expect(paidBranch).toMatch(/m\.shipment_id IS NULL OR m\.status IS DISTINCT FROM 'paid'/i);
    expect(paidBranch).toMatch(/s\.id IS NULL OR s\.stripe_payout_id IS DISTINCT FROM v_payout_id/i);
    expect(paidBranch).toMatch(/RETURN FALSE/i);
    expect(rpc).toMatch(/status IN \('pending_reconciliation', 'reconciliation_needed'\)/i);
    expect(rpc).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
  });

  test('canonical final stage definition equals the additive migration', () => {
    const migration = readFileSync(
      join(MIGRATIONS_DIR, '20260923010000_late_payout_progress_after_paid.sql'), 'utf8',
    );
    const canonical = readFileSync(
      join(MIGRATIONS_DIR, '..', 'queries', 'payments', 'connect_payout_stage_fencing.sql'), 'utf8',
    );
    const definitions = [...canonical.matchAll(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_project_payout_run_stage\b[\s\S]*?\$\$;/gi,
    )];
    expect(definitions).toHaveLength(3);
    expect(definitions[1]?.[0]).toBe(findFunction(migration, 'fn_project_payout_run_stage'));
  });
});

describe('idempotent payout progress regression override', () => {
  test('final canonical stage override accepts only healthy in-transit replay of pending', () => {
    const migration = readFileSync(join(MIGRATIONS_DIR, '20260923030000_idempotent_payout_progress_regression.sql'), 'utf8');
    const canonical = readFileSync(join(MIGRATIONS_DIR, '..', 'queries', 'payments', 'connect_payout_stage_fencing.sql'), 'utf8');
    const definitions = [...canonical.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_project_payout_run_stage\b[\s\S]*?\$\$;/gi)];
    expect(definitions).toHaveLength(3);
    const rpc = findFunction(migration, 'fn_project_payout_run_stage');
    expect(definitions.at(-1)?.[0]).toBe(rpc);
    expect(rpc).toMatch(/FOR UPDATE/i);
    expect(rpc).toMatch(/v_status = 'pending_reconciliation'\s+AND v_stage = 'payout_in_transit'\s+AND p_target_stage = 'payout_pending'/i);
    expect(rpc).toMatch(/v_claim_token IS NULL AND v_claim_expires_at IS NULL/i);
    expect(rpc).toMatch(/IF v_status IN \('pending_reconciliation', 'reconciliation_needed'\)\s+AND v_stage = p_target_stage/i);
    expect(rpc).toMatch(/v_stage IS DISTINCT FROM 'paid_observed'/i);
    expect(rpc).toMatch(/m\.status IS DISTINCT FROM 'paid'/i);
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_project_payout_run_stage FROM PUBLIC;/i);
    expect(rpc).not.toMatch(/EXCEPTION WHEN OTHERS/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_project_payout_run_stage TO service_role;/i);
  });
});

describe('stage-specific guarded park additive migration', () => {
  test('late progress on a complete failed payout is evidence-only, but incomplete or mismatched runs are not', () => {
    const migration = readFileSync(join(MIGRATIONS_DIR, '20260923040000_preserve_complete_failed_payout_progress.sql'), 'utf8');
    const canonical = readFileSync(join(MIGRATIONS_DIR, '..', 'queries', 'payments', 'fn_decide_rejected_payout_stage_park.sql'), 'utf8');
    const rpc = findFunction(migration, 'fn_decide_rejected_payout_stage_park');
    expect(findFunction(canonical, 'fn_decide_rejected_payout_stage_park').replaceAll('\r\n', '\n')).toBe(rpc.replaceAll('\r\n', '\n'));
    expect(rpc).toMatch(/FOR UPDATE/i);
    const failed = rpc.match(/IF v_status = 'failed'([\s\S]*?)RETURN 'superseded_failed';\s*END IF;/i)?.[1] ?? '';
    expect(failed).toMatch(/v_stage\s*=\s*'payout_failed'/i);
    expect(failed).toMatch(/v_payout_id\s*=\s*p_payout_id/i);
    expect(failed).toMatch(/v_claim_token IS NULL AND v_claim_expires_at IS NULL/i);
    expect(failed).toMatch(/EXISTS\s*\([\s\S]*?m\.run_id\s*=\s*p_run_id/i);
    expect(failed).toMatch(/NOT EXISTS\s*\([\s\S]*?m\.status IS DISTINCT FROM 'failed'/i);
    expect(failed).toMatch(/s\.stripe_payout_id IS NOT NULL/i);
    expect(rpc).toMatch(/IF v_payout_id IS DISTINCT FROM p_payout_id THEN[\s\S]*?RETURN 'identity_conflict'/i);
    expect(rpc).toMatch(/RETURN 'parked'/i);
  });
  test('combined canonical decision retains the final failed-run override and missing-run conflict', () => {
    const migration = readFileSync(join(MIGRATIONS_DIR, '20260923040000_preserve_complete_failed_payout_progress.sql'), 'utf8');
    const canonical = readFileSync(join(MIGRATIONS_DIR, '..', 'queries', 'payments', 'connect_payout_stage_fencing.sql'), 'utf8');
    const name = 'fn_decide_rejected_payout_stage_park';
    const rpc = findFunction(canonical, name);
    expect(rpc).not.toBe('');
    const body = (sql: string): string => sql.split(/\bAS\s+\$\$/i)[1]?.replaceAll('\r\n', '\n') ?? '';
    expect(body(rpc)).not.toBe('');
    expect(body(rpc)).toBe(body(findFunction(migration, name)));
    expect(rpc).toMatch(/IF NOT FOUND THEN\s+RETURN 'identity_conflict'/i);
    const mismatch = rpc.match(/IF v_payout_id IS DISTINCT FROM p_payout_id THEN([\s\S]*?RETURN 'identity_conflict';\s*END IF;)/i)?.[1] ?? '';
    expect(mismatch).toMatch(/UPDATE public\.connect_payout_runs[\s\S]*?status = 'reconciliation_needed'[\s\S]*?release_stage = 'action_required'/i);
    expect(mismatch).toMatch(/failure_reason = 'PAYOUT_STAGE_PAYOUT_ID_MISMATCH'/i);
    expect(mismatch).toMatch(/RETURN 'identity_conflict'/i);
    expect(mismatch).not.toMatch(/SET stripe_payout_id\s*=/i);
  });
  test('locks run and accepts only complete same-payout paid as superseded_paid, otherwise parks or reports conflict', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => /^\d+_.*payout.*(?:park|conflict).*\.sql$/.test(file));
    expect(files, 'T2 must add a NEW migration; never edit deployed migrations').toHaveLength(1);
    const sql = readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
    const rpc = findFunction(sql, 'fn_decide_rejected_payout_stage_park');
    expect(rpc).not.toBe('');
    expect(getSignature(sql, 'fn_decide_rejected_payout_stage_park')).toMatch(/p_run_id[\s\S]*p_payout_id[\s\S]*p_target_stage/i);
    expect(rpc).toMatch(/FOR\s+UPDATE/i);
    expect(rpc).toMatch(/v_status\s*=\s*'paid'/i);
    expect(rpc).toMatch(/v_stage\s*=\s*'paid_observed'/i);
    expect(rpc).toMatch(/v_payout_id\s*=\s*p_payout_id/i);
    expect(rpc).toMatch(/v_paid_at\s+IS\s+NOT\s+NULL/i);
    expect(rpc).toMatch(/NOT\s+EXISTS\s*\([\s\S]*?m\.status\s+IS\s+DISTINCT\s+FROM\s+'paid'/i);
    expect(rpc).toMatch(/s\.stripe_payout_id\s+IS\s+DISTINCT\s+FROM\s+p_payout_id/i);
    expect(rpc).toMatch(/superseded_paid/i);
    expect(rpc).toMatch(/reconciliation_needed/i);
    expect(rpc).toMatch(/action_required/i);
    expect(rpc).toMatch(/(?:conflict|incomplete)/i);
    expect(rpc).toMatch(/SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public/i);
    expect(rpc).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_decide_rejected_payout_stage_park FROM PUBLIC;/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fn_decide_rejected_payout_stage_park FROM anon, authenticated;/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_decide_rejected_payout_stage_park TO service_role;/i);
  });
});

describe('connect payout stage fencing migration', () => {
  test('adds every durable stage/fencing column additively', () => {
    const sql = readStageFencingMigration();

    for (const column of FENCE_COLUMNS) {
      expect(
        sql,
        `expected ADD COLUMN IF NOT EXISTS ${column}`,
      ).toMatch(
        new RegExp(
          `ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${column}\\b`,
          'i',
        ),
      );
    }

    // Stage version and attempt counters must default to sane starts and never
    // be NOT NULL before backfill.
    expect(sql).toMatch(
      /release_stage_version\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+1/i,
    );
    expect(sql).toMatch(/attempt_count\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i);
  });

  test('constrains release_stage to the authorized stage list including the create fence', () => {
    const sql = readStageFencingMigration();

    for (const stage of [
      'ready',
      'release_accepted',
      'transfer_created',
      'awaiting_connected_balance',
      'payout_create_in_progress',
      'payout_pending',
      'payout_in_transit',
      'paid_observed',
      'payout_failed',
      'payout_canceled',
      'action_required',
    ]) {
      expect(sql, `stage ${stage} must be allowed`).toMatch(
        new RegExp(`'${stage}'`),
      );
    }
  });

  test('backfills deployed Phase 2A runs into the stage model without touching status', () => {
    const sql = readStageFencingMigration();

    // Backfill is an UPDATE of the new stage column, not a status rewrite.
    expect(sql).toMatch(
      /UPDATE\s+public\.connect_payout_runs[\s\S]{0,400}?release_stage\s*=/i,
    );

    const stageCase = sql.match(
      /CASE[\s\S]*?'paid'[\s\S]*?'paid_observed'[\s\S]*?'failed'[\s\S]*?'payout_failed'[\s\S]*?'canceled'[\s\S]*?'payout_canceled'[\s\S]*?END/i,
    );
    expect(stageCase).not.toBeNull();

    // Pending runs split by Stripe payout existence: awaiting balance vs
    // payout pending.
    expect(sql).toMatch(
      /stripe_payout_id\s+IS\s+NOT\s+NULL[\s\S]{0,200}?'payout_pending'/i,
    );
    expect(sql).toMatch(
      /stripe_payout_id\s+IS\s+NULL[\s\S]{0,200}?'awaiting_connected_balance'/i,
    );

    // Phase 2A status must stay untouched: no status column rewrite, no
    // CHECK constraint replacement, no enum widening.
    expect(sql).not.toMatch(
      /ALTER\s+TABLE\s+public\.connect_payout_runs[\s\S]{0,200}?status\b[\s\S]{0,200}?TYPE/i,
    );
    expect(sql).not.toMatch(
      /DROP\s+CONSTRAINT[\s\S]{0,200}?connect_payout_runs_status_check/i,
    );
    expect(sql).not.toMatch(
      /ADD\s+CONSTRAINT[\s\S]{0,200}?connect_payout_runs_status_check/i,
    );
  });

  test('keeps the legacy terminal status CHECK intact (Phase 2A compatibility)', () => {
    const sql = readStageFencingMigration();

    // The migration must neither remove nor re-create the deployed status
    // CHECK constraint that Phase 2A code paths rely on.
    expect(sql).not.toMatch(
      /DROP\s+CONSTRAINT[\s\S]{0,120}?status/i,
    );
  });

  test('stage transition RPC is SECURITY DEFINER with pinned search_path and bounded validation', () => {
    const sql = readStageFencingMigration();
    const rpc = findFunction(sql, 'fn_transition_payout_release_stage');

    expect(rpc).not.toBe('');
    expect(rpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(rpc).toMatch(/SET\s+search_path\s*=\s*public/i);
    // Unknown stages are rejected.
    expect(rpc).toMatch(/UNSUPPORTED_RELEASE_STAGE|INVALID_RELEASE_STAGE/i);
  });

  test('stage transition RPC refuses terminal and action_required regression', () => {
    const rpc = findFunction(
      readStageFencingMigration(),
      'fn_transition_payout_release_stage',
    );

    // Terminal stages may never regress to a non-terminal stage.
    expect(rpc).toMatch(
      /paid_observed[\s\S]{0,200}?payout_failed[\s\S]{0,200}?payout_canceled/i,
    );
    expect(rpc).toMatch(
      /TERMINAL_STAGE_REGRESSION|STAGE_TRANSITION_BLOCKED/i,
    );
  });

  test('stage transition RPC is conditional on the claim token and stage version', () => {
    const rpc = findFunction(
      readStageFencingMigration(),
      'fn_transition_payout_release_stage',
    );

    expect(rpc).toMatch(/p_claim_token/i);
    expect(rpc).toMatch(/p_expected_stage_version/i);
    expect(rpc).toMatch(
      /STALE_CLAIM|STALE_WORKER|CLAIM_CONFLICT/i,
    );
    expect(rpc).toMatch(
      /STAGE_VERSION_CONFLICT|VERSION_CONFLICT/i,
    );
  });

  test('payout-create fence RPCs write the durable write-ahead fence conditionally', () => {
    const sql = readStageFencingMigration();

    const begin = findFunction(sql, 'fn_begin_payout_create_fence');
    const complete = findFunction(sql, 'fn_complete_payout_create_fence');

    expect(begin).not.toBe('');
    expect(begin).toMatch(/payout_create_in_progress/i);
    expect(begin).toMatch(/payout_create_attempted_at/i);
    expect(begin).toMatch(/p_claim_token/i);
    expect(begin).toMatch(/p_expected_stage_version/i);

    expect(complete).not.toBe('');
    // Completion requires a Stripe payout id and never regresses a terminal
    // webhook projection back to payout_pending.
    expect(complete).toMatch(/p_stripe_payout_id/i);
    expect(complete).toMatch(/payout_create_in_progress/i);
    expect(complete).toMatch(/p_claim_token/i);
  });

  test('both claim-clear and fence writes clear the executor claim token', () => {
    const sql = readStageFencingMigration();

    expect(sql).toMatch(
      /payout_claim_token\s*=\s*NULL/i,
    );
  });

  test('indexes pre-payout executor candidates by stage and next attempt', () => {
    const sql = readStageFencingMigration();

    expect(sql).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS[\s\S]{0,120}?release_stage[\s\S]{0,120}?next_attempt_at/i,
    );
  });

  test('keeps every new RPC out of public reach with service_role-only EXECUTE', () => {
    const sql = readStageFencingMigration();

    for (const rpc of [
      'fn_transition_payout_release_stage',
      'fn_begin_payout_create_fence',
      'fn_complete_payout_create_fence',
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

  test('grants no direct table privileges through the stage fencing migration', () => {
    const sql = readStageFencingMigration();

    expect(sql).not.toMatch(
      /GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE)\s+ON\s+(TABLE\s+)?public\.connect_payout_runs\b/i,
    );
  });

  test('every guarded UPDATE SET region is a well-formed comma-separated assignment list', () => {
    const sql = readStageFencingMigration();

    const functions = [
      ...sql.matchAll(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)[\s\S]*?AS\s+\$\$([\s\S]*?)\$\$;/gi,
      ),
    ];
    expect(functions.length).toBeGreaterThan(0);

    for (const [, name, body] of functions) {
      const setRegions = [
        ...body.matchAll(/UPDATE[\s\S]*?\bSET\s+([\s\S]*?)\bWHERE\b/gi),
      ];
      for (const [, region] of setRegions) {
        const chunks = region.split(',').map((chunk) => chunk.trim());
        const targets: string[] = [];
        for (const chunk of chunks) {
          // A missing comma glues two assignments into one chunk, which makes
          // the whole migration unparseable at apply time.
          const lineStarts =
            chunk.match(/^[ \t]*[a-z_][a-z0-9_]*[ \t]*=/gim) ?? [];
          expect(
            lineStarts.length,
            `${name}: malformed SET region chunk: "${chunk}"`,
          ).toBeLessThanOrEqual(1);

          const target = chunk.match(/^[ \t]*([a-z_][a-z0-9_]*)[ \t]*=/i)?.[1];
          if (target) targets.push(target);
        }
        const duplicates = targets.filter(
          (target, index) => targets.indexOf(target) !== index,
        );
        expect(duplicates, `${name}: duplicate SET assignment targets`).toEqual(
          [],
        );
      }
    }
  });

  test('the terminal projection clears the actual claim token column as well as the lease', () => {
    const sql = readStageFencingMigration();
    const rpc = findFunction(sql, 'fn_project_payout_run_terminal');

    expect(rpc).not.toBe('');
    expect(rpc).toMatch(/payout_claim_token\s*=\s*NULL/i);
    expect(rpc).toMatch(/payout_claim_expires_at\s*=\s*NULL/i);
    // One guarded write per table in the atomic unit: the run, the paid
    // mapping branch, the failure mapping branch, the paid shipment branch,
    // and the failure shipment branch.
    expect(rpc.match(/updated_at\s*=\s*now\(\)/gi) ?? []).toHaveLength(5);
  });

  test('the executor create fence refuses an expired claim lease', () => {
    const begin = findFunction(
      readStageFencingMigration(),
      'fn_begin_payout_create_fence',
    );

    expect(begin).not.toBe('');
    expect(begin).toMatch(/CLAIM_LEASE_EXPIRED/i);
    expect(begin).toMatch(
      /(?:v_expires|payout_claim_expires_at)\s+IS\s+NULL\s+OR\s+(?:v_expires|payout_claim_expires_at)\s*<=\s*now\(\)/i,
    );
  });

  test('the manual release path opens the same durable write-ahead create fence', () => {
    const sql = readStageFencingMigration();
    const begin = findFunction(sql, 'fn_begin_manual_payout_create_fence');

    expect(begin).not.toBe('');
    expect(begin).toMatch(/SECURITY\s+DEFINER/i);
    expect(begin).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(begin).toMatch(/payout_create_in_progress/i);
    expect(begin).toMatch(/payout_create_attempted_at\s*=\s*now\(\)/i);
    // Refuses an already-open fence (reconciliation territory) so the manual
    // endpoint can never create over an unreconciled Stripe attempt.
    expect(begin).toMatch(/PAYOUT_CREATE_FENCE_CONFLICT/i);
  });

  test('the manual create fence refuses any executor claim atomically under the row lock', () => {
    const sql = readStageFencingMigration();
    const begin = findFunction(sql, 'fn_begin_manual_payout_create_fence');

    expect(begin).not.toBe('');
    // The claim inspection must share the same FOR UPDATE row lock as the
    // fence write: a worker claim landing concurrently conflicts instead of
    // racing the manual fence between the inspect and the write.
    const inspect = begin.match(/SELECT[\s\S]*?FOR\s+UPDATE\s*;/i)?.[0] ?? '';
    expect(inspect).not.toBe('');
    expect(inspect).toMatch(/payout_claim_token/i);

    // A live executor claim means a worker is mid-flight: the manual path
    // must never open the fence from under it.
    expect(begin).toMatch(/EXECUTOR_CLAIM_HELD/i);
    expect(begin).toMatch(/v_token\s+IS\s+NOT\s+NULL/i);

    // A lapsed claim is reclaimed only by the worker claim flow, never by a
    // manual bypass: the held token alone (lease expiry is irrelevant here)
    // gates the manual fence.
    expect(begin).not.toMatch(/payout_claim_expires_at/i);
  });

  test('fence exits are version-conditional, token-optional for the manual path, and clear the executor claim', () => {
    const sql = readStageFencingMigration();

    for (const name of [
      'fn_complete_payout_create_fence',
      'fn_fail_payout_create_from_fence',
      'fn_abort_payout_create_to_action_required',
    ]) {
      const rpc = findFunction(sql, name);
      expect(rpc, `${name} must exist`).not.toBe('');
      // The manual release path passes no executor claim token: the fence
      // stage plus the monotonic version are its durable ownership. The
      // optional parameter's valid ordering is asserted by its own test
      // below, not by a positional text match here.
      expect(rpc).toMatch(
        /p_claim_token\s+IS\s+NULL\s+OR\s+\(\s*payout_claim_token\s*=\s*p_claim_token/i,
      );
      expect(rpc).toMatch(/p_expected_stage_version/i);
      expect(rpc).toMatch(/payout_claim_token\s*=\s*NULL/i);
    }
  });

  test('fence exits require an unexpired lease whenever an executor claim token is supplied', () => {
    const sql = readStageFencingMigration();

    for (const name of [
      'fn_complete_payout_create_fence',
      'fn_fail_payout_create_from_fence',
      'fn_abort_payout_create_to_action_required',
    ]) {
      const rpc = findFunction(sql, name);
      expect(rpc, `${name} must exist`).not.toBe('');
      // The executor-owned exit proves token AND unexpired lease: a worker
      // whose lease lapsed mid-flight must not mutate the fenced run; the
      // reconciliation claim resolves it instead.
      expect(
        rpc,
        `${name} must gate the claim token on an unexpired lease`,
      ).toMatch(
        /payout_claim_token\s*=\s*p_claim_token\s+AND\s+payout_claim_expires_at\s*>\s*now\(\)/i,
      );
    }
  });

  test('the guarded stage transition requires an unexpired lease when a claim token is supplied', () => {
    const rpc = findFunction(
      readStageFencingMigration(),
      'fn_transition_payout_release_stage',
    );

    expect(rpc).not.toBe('');
    expect(rpc).toMatch(/CLAIM_LEASE_EXPIRED/i);
    // The lease is inspected under the same row lock as the transition.
    const inspect = rpc.match(/SELECT[\s\S]*?FOR\s+UPDATE\s*;/i)?.[0] ?? '';
    expect(inspect).not.toBe('');
    expect(inspect).toMatch(/payout_claim_expires_at/i);
  });

  test('optional claim-token parameters come after every required parameter', () => {
    const sql = readStageFencingMigration();

    // PostgreSQL only permits parameters with DEFAULTs after all required
    // parameters; an optional p_claim_token declared before a required one
    // makes the migration unparseable at apply time.
    for (const name of [
      'fn_complete_payout_create_fence',
      'fn_fail_payout_create_from_fence',
      'fn_abort_payout_create_to_action_required',
    ]) {
      const signature = getSignature(sql, name);
      expect(signature, `${name} signature must be found`).not.toBe('');

      const params = signature.split(',').map((param) => param.trim());
      const claimTokenIndex = params.findIndex((param) =>
        /^p_claim_token\b/.test(param),
      );
      expect(
        claimTokenIndex,
        `${name} must declare p_claim_token`,
      ).toBeGreaterThan(-1);
      expect(
        claimTokenIndex,
        `${name}: p_claim_token (optional, DEFAULT NULL) must be the last declared parameter`,
      ).toBe(params.length - 1);
      expect(
        params[claimTokenIndex],
        `${name}: p_claim_token must remain token-optional via DEFAULT NULL`,
      ).toMatch(/TEXT\s+DEFAULT\s+NULL/i);
    }
  });

  test('PL/pgSQL bodies contain no C++-style // comments', () => {
    const sql = readStageFencingMigration();

    const bodies = [
      ...sql.matchAll(/AS\s+\$\$([\s\S]*?)\$\$;/gi),
    ].map((match) => match[1]);
    expect(bodies.length).toBeGreaterThan(0);

    for (const body of bodies) {
      const offenders = body
        .split('\n')
        .filter((line) => /\/\//.test(line));
      expect(
        offenders,
        'C++-style // comments must use SQL -- comments (they make the migration unparseable)',
      ).toEqual([]);
    }
  });

  test('the manual path fence RPCs stay service_role-only', () => {
    const sql = readStageFencingMigration();

    for (const rpc of [
      'fn_begin_manual_payout_create_fence',
      'fn_complete_payout_create_fence',
      'fn_fail_payout_create_from_fence',
      'fn_abort_payout_create_to_action_required',
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

  test('webhook stage projection is monotonic: payout_in_transit never regresses to payout_pending', () => {
    const rpc = findFunction(
      readStageFencingMigration(),
      'fn_project_payout_run_stage',
    );

    expect(rpc).not.toBe('');
    const pendingBranch = rpc.match(
      /p_target_stage\s*=\s*'payout_pending'([\s\S]*?)p_target_stage\s*=\s*'payout_in_transit'/i,
    )?.[1];
    expect(pendingBranch).toBeTruthy();
    // The payout_pending gate must not accept a run already in transit.
    expect(pendingBranch).not.toMatch(/payout_in_transit/i);
    expect(pendingBranch).toMatch(/payout_create_in_progress/i);
  });

  test('the stage projection treats an already-at-target run as a benign no-op, not a rejection', () => {
    const rpc = findFunction(
      readStageFencingMigration(),
      'fn_project_payout_run_stage',
    );

    expect(rpc).not.toBe('');
    // A duplicate progression (e.g. payout.created replayed after the worker
    // already completed the fence into payout_pending) must return TRUE as a
    // no-op: it is neither a regression nor a reason to park the run. The
    // overloaded FALSE must be reserved for genuine refusals.
    expect(rpc).not.toMatch(
      /release_stage\s+IS\s+DISTINCT\s+FROM\s+p_target_stage/i,
    );
    expect(rpc).toMatch(
      /v_stage\s*=\s*p_target_stage[\s\S]{0,160}?RETURN\s+TRUE/i,
    );
    // The write stays guarded by the stage it inspected and the pre-terminal
    // status set, so the monotonic gate still owns the ordering.
    expect(rpc).toMatch(/FOR\s+UPDATE/i);
    expect(rpc).toMatch(
      /status\s+IN\s*\(\s*'pending_reconciliation'\s*,\s*'reconciliation_needed'\s*\)/i,
    );
  });

  test('the reconciliation-needed park is a guarded RPC that never regresses terminal evidence', () => {
    const sql = readStageFencingMigration();
    const rpc = findFunction(sql, 'fn_mark_payout_run_reconciliation_needed');

    expect(rpc, 'the park RPC must exist').not.toBe('');
    expect(rpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(rpc).toMatch(/SET\s+search_path\s*=\s*public/i);
    // The park moves the aggregate to the action_required stage and bumps
    // the monotonic version, so concurrent version-conditional writers
    // conflict instead of overwriting a newer decision.
    expect(rpc).toMatch(/status\s*=\s*'reconciliation_needed'/i);
    expect(rpc).toMatch(/release_stage\s*=\s*'action_required'/i);
    expect(rpc).toMatch(/release_stage_version\s*=\s*release_stage_version\s*\+\s*1/i);
    // The webhook wins over an in-flight worker, exactly like the terminal
    // projection: the executor claim and its lease clear with the park.
    expect(rpc).toMatch(/payout_claim_token\s*=\s*NULL/i);
    expect(rpc).toMatch(/payout_claim_expires_at\s*=\s*NULL/i);
    // Terminal evidence is never destroyed by a park: paid_at and failed_at
    // stay exactly as the terminal projection wrote them.
    expect(rpc).not.toMatch(/paid_at\s*=/i);
    expect(rpc).not.toMatch(/failed_at\s*=/i);
  });

  // -----------------------------------------------------------------------
  // Phase 2B final remediation slice: the webhook terminal projection is ONE
  // atomic unit (run + shipment mappings + shipment payout-id set/clear in
  // the same SECURITY DEFINER transaction), and the manual release path's
  // post-Stripe sync fallback is a guarded RPC that can never regress a
  // terminal outcome.
  // -----------------------------------------------------------------------
  test('the terminal projection applies run, mapping, and shipment payout effects in one atomic RPC', () => {
    const sql = readStageFencingMigration();
    const rpc = findFunction(sql, 'fn_project_payout_run_terminal');

    expect(rpc).not.toBe('');
    // All three tables are written by the same function body: the guarded run
    // projection, the monotonic mapping projection, and the shipment payout-id
    // set/clear. No separate webhook write may follow a run projection.
    expect(rpc).toMatch(/UPDATE\s+public\.connect_payout_runs\b/i);
    expect(rpc).toMatch(/UPDATE\s+public\.connect_payout_run_shipments\b/i);
    expect(rpc).toMatch(/UPDATE\s+public\.shipments\b/i);
    // One transaction: the RPC body must never end its own transaction.
    expect(rpc).not.toMatch(/\bCOMMIT\b/i);
    expect(rpc).not.toMatch(/\bROLLBACK\b/i);
    expect(rpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(rpc).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  test('the atomic terminal projection refuses a conflicting release instead of partially releasing', () => {
    const rpc = findFunction(
      readStageFencingMigration(),
      'fn_project_payout_run_terminal',
    );

    // A mapped shipment already carrying a DIFFERENT payout id refuses the
    // whole projection: the raised error rolls back the run write too, so no
    // partial release is ever committed and the webhook parks on it.
    expect(rpc).toMatch(/SHIPMENT_ALREADY_RELEASED/i);
    // The paid target sets the payout id only where it is still NULL.
    expect(rpc).toMatch(/AND\s+stripe_payout_id\s+IS\s+NULL/i);
  });

  test('the atomic terminal projection clears only the failing payout id on a late downgrade', () => {
    const rpc = findFunction(
      readStageFencingMigration(),
      'fn_project_payout_run_terminal',
    );

    // Late paid -> failed/canceled clears the shipment payout id ONLY where it
    // equals the failing payout id, so an older or unrelated event can never
    // unrelease another payout's shipment (Phase 2A late-reversal contract).
    expect(rpc).toMatch(/AND\s+stripe_payout_id\s*=\s*p_payout_id/i);
  });

  test('the atomic terminal projection keeps the monotonic mapping filter inside the unit', () => {
    const rpc = findFunction(
      readStageFencingMigration(),
      'fn_project_payout_run_terminal',
    );

    // A paid outcome may only advance pending mappings (never regresses a
    // recorded failure); failure and cancellation projections may advance
    // both pending and paid mappings when the signed event documents the
    // downgrade.
    const mappingFilters =
      [
        ...rpc.matchAll(
          /UPDATE\s+public\.connect_payout_run_shipments[\s\S]*?status\s+IN\s*\(([^)]*)\)/gi,
        ),
      ].map((match) => match[1]);
    expect(mappingFilters).toHaveLength(2);
    expect(mappingFilters[0]).toMatch(/'pending_reconciliation'/);
    expect(mappingFilters[0]).not.toMatch(/'paid'/);
    expect(mappingFilters[1]).toMatch(
      /'pending_reconciliation'\s*,\s*'paid'/,
    );
  });

  test('the post-Stripe sync fallback RPC is guarded and never regresses terminal authority', () => {
    const sql = readStageFencingMigration();
    const rpc = findFunction(sql, 'fn_mark_payout_run_sync_failed');

    expect(rpc, 'the sync fallback RPC must exist').not.toBe('');
    expect(rpc).toMatch(/SECURITY\s+DEFINER/i);
    expect(rpc).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(rpc).toMatch(/status\s*=\s*'reconciliation_needed'/i);
    // Refuses terminal/newer state: a webhook already projected a terminal
    // outcome, and the fallback must preserve that authority untouched.
    expect(rpc).toMatch(
      /status\s+NOT\s+IN\s*\(\s*'paid'\s*,\s*'failed'\s*,\s*'canceled'\s*\)/i,
    );
    // Idempotent no-op: an already-parked run with the same recorded reason
    // does not bump the monotonic version again.
    expect(rpc).toMatch(
      /status\s+IS\s+DISTINCT\s+FROM\s+'reconciliation_needed'/i,
    );
    // The durable payout_create_in_progress fence stays: the reconciliation
    // claim (never a second create) recovers the run, so no stage rewrite.
    expect(rpc).not.toMatch(/release_stage\s*=/i);
    // The actual write stays fenced: version bump plus claim clearing.
    expect(rpc).toMatch(
      /release_stage_version\s*=\s*release_stage_version\s*\+\s*1/i,
    );
    expect(rpc).toMatch(/payout_claim_token\s*=\s*NULL/i);
    expect(rpc).toMatch(/payout_claim_expires_at\s*=\s*NULL/i);
  });

  test('the post-Stripe sync fallback RPC stays service_role-only', () => {
    const sql = readStageFencingMigration();
    const rpc = 'fn_mark_payout_run_sync_failed';

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

    expect(publicRevoke, 'missing PUBLIC revoke for the sync fallback RPC').toBeGreaterThan(
      -1,
    );
    expect(roleRevoke).toBeGreaterThan(publicRevoke);
    expect(rpcGrant).toBeGreaterThan(roleRevoke);
  });

  test('the reconciliation park RPC stays service_role-only', () => {
    const sql = readStageFencingMigration();
    const rpc = 'fn_mark_payout_run_reconciliation_needed';

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

    expect(publicRevoke, 'missing PUBLIC revoke for the park RPC').toBeGreaterThan(
      -1,
    );
    expect(roleRevoke).toBeGreaterThan(publicRevoke);
    expect(rpcGrant).toBeGreaterThan(roleRevoke);
  });
});
