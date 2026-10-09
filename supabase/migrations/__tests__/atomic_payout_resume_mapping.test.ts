import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source contracts only; these checks do not execute PostgreSQL.
const migration = join(import.meta.dir, '../20261008090000_atomic_payout_resume_mapping.sql');
const canonical = join(import.meta.dir, '../../queries/payments/atomic_payout_resume_mapping.sql');
const sql = existsSync(migration) ? readFileSync(migration, 'utf8') : '';
test('specialized atomic RPC exists with locked server CAS and a version increment', () => {
  expect(sql).toContain('fn_atomic_payout_resume_mapping');
  expect(sql).toContain('FOR UPDATE');
  expect(sql).toContain('IS DISTINCT FROM p_expected_status');
  expect(sql).toContain('IS DISTINCT FROM p_expected_stage');
  expect(sql).toContain('IS DISTINCT FROM p_expected_version');
  expect(sql).toContain('release_stage_version = release_stage_version + 1');
});
test('RPC refuses newer identity, claims, create fences, terminal results and child authority', () => {
  for (const guard of ['stripe_payout_id IS NOT NULL', 'payout_claim_token IS NOT NULL', 'payout_claim_expires_at IS NOT NULL', 'payout_create_attempted_at IS NOT NULL', 'paid_at IS NOT NULL', 'retry_of_run_id = v_run.id', 'p_expected_parent_version']) expect(sql).toContain(guard);
  expect(sql).toContain('RETURN NULL');
  expect(sql).toContain('EXCEPT');
});
test('mapping validation precedes both writes and is transactional', () => {
  expect(sql).toContain('count(DISTINCT shipment_id)');
  expect(sql).toContain('sum(net_payout)');
  expect(sql).toContain('UPDATE public.connect_payout_run_shipments');
  expect(sql.indexOf('UPDATE public.connect_payout_run_shipments')).toBeGreaterThan(sql.indexOf('UPDATE public.connect_payout_runs'));
  expect(sql).toMatch(/^--[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/);
});
test('privileged RPC has pinned search path and service-role-only execution', () => {
  expect(sql).toContain('SECURITY DEFINER');
  expect(sql).toContain('SET search_path = public');
  expect(sql).toMatch(/REVOKE EXECUTE[\s\S]*FROM PUBLIC, anon, authenticated/);
  expect(sql).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/);
});
test('SQL rejects inconsistent mappings and preserves immutable parent/financial fields', () => {
  expect(sql).toContain('v_run.retry_of_run_id IS DISTINCT FROM p_parent_run_id');
  expect(sql).toContain("v_parent.release_stage IS DISTINCT FROM 'payout_failed'");
  expect(sql).toContain('v_parent.seller_id <> v_run.seller_id OR v_parent.amount <> v_run.amount');
  expect(sql).toContain("run_id = v_parent.id AND status <> 'failed'");
  expect(sql).toContain('m.status <> v_run.status');
  expect(sql).toContain('s.seller_id <> v_run.seller_id');
  expect(sql).toContain("p_mode = 'pending' AND s.stripe_transfer_id IS NULL");
  const writes = sql.slice(sql.indexOf('UPDATE public.connect_payout_runs'));
  expect(writes).not.toMatch(/SET[\s\S]*?(?:stripe_payout_id|payout_claim_token|payout_claim_expires_at|payout_create_attempted_at|amount|retry_of_run_id)\s*=/);
  expect(writes).not.toContain('v_parent.id');
});
test('manual adapters use only the specialized RPC with explicit response refusal', () => {
  const entrypoint = readFileSync(join(import.meta.dir, '../../functions/release-connect-payout/index.ts'), 'utf8');
  expect(entrypoint).toContain("from './atomic-resume-adapter.ts'");
  expect(entrypoint).toContain('...createAtomicResumeAdapters((name, args) => supabaseAdmin.rpc(name, args))');
  const factory = readFileSync(join(import.meta.dir, '../../functions/release-connect-payout/atomic-resume-adapter.ts'), 'utf8');
  for (const name of ['markRunRetrying', 'markRunPendingReconciliation']) {
    const block = factory.slice(factory.indexOf(`${name}: async`));
    const adapter = block.slice(0, block.indexOf('\n    },') + 7);
    expect(adapter).toContain("'fn_atomic_payout_resume_mapping'");
    expect(adapter).toContain('atomicResumeMappingArgs(input,');
    expect(adapter).toContain("typeof data === 'number'");
    expect(adapter).not.toContain('.update(');
    expect(adapter).not.toContain('.select(');
  }
  const orchestrator = readFileSync(join(import.meta.dir, '../../functions/release-connect-payout/release-connect-payout.ts'), 'utf8');
  expect(orchestrator.indexOf('const resumedIntent =')).toBeLessThan(orchestrator.indexOf('await deps.retrieveStripePayout('));
  expect(orchestrator).toContain('assertResumeApplied(await deps.markRunPendingReconciliation(resumeIntent))');
  expect(orchestrator).toContain('const version = assertResumeApplied(await deps.markRunRetrying(resumeIntent))');
  expect(orchestrator).not.toContain('Database &');
});
test('canonical is byte-identical to the forward migration', () => {
  expect(existsSync(canonical)).toBe(true);
  if (existsSync(canonical)) expect(readFileSync(canonical)).toEqual(readFileSync(migration));
});
