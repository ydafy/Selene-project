import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const historical = (name: string): string => readFileSync(join(root, name), 'utf8');
const forwardPath = join(root, '20261007000000_stripe_fee_reconciliation_leases.sql');
const forward = existsSync(forwardPath) ? readFileSync(forwardPath, 'utf8') : '';
const rpcHistory = historical('20260918020041_stripe_fee_reconciliation_job_rpcs.sql');
const completionHistory = historical('20260918063331_complete_stripe_fee_reconciliation_job.sql');
const tableHistory = historical('20260918013144_stripe_fee_reconciliation_jobs.sql');
const functionBody = (sql: string, name: string): string =>
  sql.match(new RegExp(`CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
// Start RED from real historical implementations, not a missing-file exception.
const effectiveRpc = (stem: string, history: string): string =>
  functionBody(forward, `${stem}_leased`) || functionBody(history, stem);
const claim = effectiveRpc('fn_claim_stripe_fee_reconciliation_jobs', rpcHistory);
const transition = effectiveRpc('fn_transition_stripe_fee_reconciliation_job', rpcHistory);
const complete = effectiveRpc('fn_complete_stripe_fee_reconciliation_job', completionHistory);

describe('fee lease SQL source contracts (not PostgreSQL execution)', () => {
  test('validates both bounded policy parameters including NULL', () => {
    expect(claim).toMatch(/p_limit\s+IS\s+NULL/i);
    expect(claim).toMatch(/p_limit\s*<\s*1\s+OR\s+p_limit\s*>\s*100/i);
    expect(claim).toMatch(/p_max_attempts\s+IS\s+NULL/i);
    expect(claim).toMatch(/p_max_attempts\s*<\s*1\s+OR\s+p_max_attempts\s*>\s*100/i);
  });

  test('checks expiry with wall clock after job and order locks before fee writes', () => {
    const beforeFee = complete.split(/UPDATE\s+public\.orders/i)[0];
    const orderLock = beforeFee.search(/FROM\s+public\.orders[\s\S]*?FOR\s+UPDATE/i);
    expect(orderLock).toBeGreaterThan(0);
    expect(beforeFee.slice(orderLock)).toMatch(/claim_expires_at\s*<=\s*clock_timestamp\(\)/i);
    expect(beforeFee).toMatch(/v_payment_intent_id\s+IS\s+DISTINCT\s+FROM\s+v_job\.stripe_payment_intent_id/i);
    expect(beforeFee).not.toMatch(/claim_expires_at\s*<=\s*now\(\)/i);
  });

  test('success replay checks the matching non-NULL token and retains token evidence', () => {
    const replay = complete.indexOf("v_job.status = 'succeeded'");
    expect(replay).toBeGreaterThan(0);
    expect(complete.slice(0, replay)).toMatch(/p_claim_token\s+IS\s+NULL/i);
    expect(complete.slice(0, replay)).toMatch(/claim_token\s+IS\s+DISTINCT\s+FROM\s+p_claim_token/i);
    const successWrite = complete.split(/UPDATE\s+public\.stripe_fee_reconciliation_jobs/i)[1];
    expect(successWrite).toMatch(/claim_expires_at\s*=\s*NULL/i);
    expect(successWrite).not.toMatch(/claim_token\s*=/i);
  });

  test('transition cannot bypass atomic completion with succeeded', () => {
    expect(transition).toMatch(/p_outcome\s+NOT\s+IN\s*\(\s*'retry',\s*'failed'\s*\)/i);
    expect(transition).not.toMatch(/WHEN\s+'succeeded'|status\s*=\s*'succeeded'/i);
    expect(transition).toMatch(/claim_token\s*=\s*NULL,\s*claim_expires_at\s*=\s*NULL/i);
  });
  test('stores opaque ownership and database-clock expiry', () => {
    expect(tableHistory + forward).toMatch(/claim_token\s+UUID/i);
    expect(tableHistory + forward).toMatch(/claim_expires_at\s+TIMESTAMPTZ/i);
    expect(claim).toMatch(/claim_token\s*=\s*gen_random_uuid\(\)/i);
    expect(claim).toMatch(/claim_expires_at\s*=\s*(?:now|clock_timestamp)\(\)\s*\+/i);
  });

  test('bounded locked claim includes expired processing, not an unexpired owner', () => {
    expect(claim).toMatch(/FOR\s+UPDATE\s+SKIP\s+LOCKED/i);
    expect(claim).toMatch(/LIMIT\s+GREATEST\(1,\s*LEAST\(p_limit,\s*100\)\)/i);
    expect(claim).toMatch(/status\s*=\s*'processing'[\s\S]*?claim_expires_at\s*<=\s*(?:now|clock_timestamp)\(\)/i);
  });

  test('bounds adoption of tokenless legacy processing with a database-clock age threshold', () => {
    expect(claim).toMatch(/claim_token\s+IS\s+NULL/i);
    expect(claim).toMatch(/claim_expires_at\s+IS\s+NULL/i);
    expect(claim).toMatch(/updated_at\s*<=\s*(?:now|clock_timestamp)\(\)\s*-\s*INTERVAL/i);
  });

  test('expired processing at attempt exhaustion is terminalized rather than stranded', () => {
    expect(claim).toMatch(/p_max_attempts\s+INTEGER/i);
    expect(claim).toMatch(/attempt_count\s*>=\s*p_max_attempts/i);
    expect(claim).toMatch(/status\s*=\s*'failed'/i);
    expect(claim).toContain('STRIPE_FEE_ATTEMPTS_EXHAUSTED');
  });

  for (const [name, sql] of [['transition', transition], ['completion', complete]] as const) {
    test(`${name} rejects NULL, stale, nonexistent and expired ownership before writes`, () => {
      expect(sql).toMatch(/p_claim_token\s+UUID/i);
      expect(sql).toMatch(/p_claim_token\s+IS\s+NULL/i);
      expect(sql).toMatch(/claim_token\s*(?:=\s*p_claim_token|IS\s+DISTINCT\s+FROM\s+p_claim_token)/i);
      expect(sql).toMatch(/claim_expires_at\s*(?:>|<=)\s*(?:now|clock_timestamp)\(\)/i);
      expect(sql).toMatch(/IF\s+NOT\s+FOUND[\s\S]*?(?:RETURN\s+FALSE|RAISE\s+EXCEPTION)/i);
      const write = sql.search(/UPDATE\s+public\./i);
      expect(sql.slice(0, write)).toMatch(/FOR\s+UPDATE/i);
      expect(sql.slice(0, write)).toContain('p_claim_token');
    });
  }

  test('completion retains atomic fee/job projection and never overwrites an existing fee', () => {
    expect(complete).toMatch(/actual_stripe_fee_cents\s+IS\s+NULL/i);
    expect(complete).toMatch(/UPDATE\s+public\.orders[\s\S]*?UPDATE\s+public\.stripe_fee_reconciliation_jobs/i);
    expect(complete).toMatch(/status\s*=\s*'succeeded'/i);
    expect(complete).not.toMatch(/fn_process_order|fn_release|stripe_transfer_id\s*=/i);
  });

  test('duplicate same-token completion returns without repeating the fee write', () => {
    const beforeFeeWrite = complete.split(/UPDATE\s+public\.orders/i)[0];
    expect(beforeFeeWrite).toMatch(/status\s*=\s*'succeeded'[\s\S]*?RETURN\s+TRUE/i);
    expect(beforeFeeWrite).toContain('p_claim_token');
  });

  for (const stem of ['fn_claim_stripe_fee_reconciliation_jobs', 'fn_transition_stripe_fee_reconciliation_job', 'fn_complete_stripe_fee_reconciliation_job']) {
    test(`legacy tokenless ${stem} fails closed without mutation`, () => {
      const history = stem.includes('complete') ? completionHistory : rpcHistory;
      const sql = functionBody(forward, stem) || functionBody(history, stem);
      expect(sql).toContain('STRIPE_FEE_LEASE_REQUIRED');
      expect(sql).not.toMatch(/UPDATE\s+public\./i);
    });
  }

  test('versioned leased RPCs remain service-role-only with fixed search_path', () => {
    for (const sql of [claim, transition, complete]) {
      expect(sql).toContain('SECURITY DEFINER');
      expect(sql).toMatch(/SET\s+search_path\s*=\s*public,\s*pg_temp/i);
      expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    }
    for (const stem of ['fn_claim_stripe_fee_reconciliation_jobs', 'fn_transition_stripe_fee_reconciliation_job', 'fn_complete_stripe_fee_reconciliation_job']) {
      expect(forward).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${stem}_leased\\([^;]*?FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i'));
      expect(forward).toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${stem}_leased\\([^;]*?TO\\s+service_role`, 'i'));
    }
  });
});
