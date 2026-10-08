import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Tables } from '../packages/types/src/index';
import { runLeaseProof, createRestApi, TARGET, APPROVAL } from './verify-stripe-fee-lease-recovery';

const ID = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
function sandbox() {
  let now = Date.parse('2026-10-07T00:00:00Z');
  const order: Tables<'orders'> = { id: TARGET.order, status: 'paid', stripe_payment_intent_id: TARGET.pi,
    actual_stripe_fee_cents: 6817, stripe_fee_reconciled_at: TARGET.at, updated_at: new Date(now).toISOString(),
    buyer_id: '44444444-4444-4444-8444-444444444444', cancellation_loss_cents: null,
    compensation_attempt_count: 0, compensation_last_error: null, compensation_lease_expires_at: null,
    compensation_state: null, completed_at: null, created_at: new Date(now).toISOString(), currency: 'mxn',
    delivered_at: null, next_compensation_retry_at: null, payment_processing: false,
    payment_processing_reason: null, service_fee_amount: null, shipping_address: {},
    stripe_charge_id: null, stripe_refund_id: null, stripe_transfer_group: null, total_amount: 100,
  } satisfies Tables<'orders'>;
  const row = (id: string): Tables<'stripe_fee_reconciliation_jobs'> => ({ id, order_id: '44444444-4444-4444-8444-444444444444',
    stripe_payment_intent_id: 'pi_history', status: 'succeeded', attempt_count: 1,
    claim_token: null, claim_expires_at: null, next_retry_at: null, last_error: null,
    created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() });
  let jobs = Array.from({ length: 18 }, (_, i) => row(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  const logs: string[] = [], waits: number[] = [];
  let claim = 0;
  let fault: ((path: string, method: string, body?: Record<string, unknown>) => unknown) | undefined;
  const api = async (path: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> => {
    calls.push({ path, method, body });
    const overridden = fault?.(path, method, body);
    if (overridden !== undefined) return overridden;
    if (path.startsWith('orders?')) return structuredClone([order]);
    if (method === 'DELETE') { const deleted = jobs.filter(j => j.id === ID); jobs = jobs.filter(j => j.id !== ID); return structuredClone(deleted); }
    if (method === 'GET') return structuredClone(path.includes(`id=eq.${ID}`) ? jobs.filter(j => j.id === ID) : jobs);
    if (path.startsWith('rpc/fn_claim')) {
      claim++;
      if (claim === 2) return [];
      const job = jobs.find(j => j.id === ID)!;
      Object.assign(job, { status: 'processing', attempt_count: claim === 1 ? 1 : 2,
        claim_token: claim === 1 ? A : B, claim_expires_at: new Date(now + 300000).toISOString() });
      return structuredClone([job]);
    }
    if (path.startsWith('rpc/fn_complete')) {
      if (body?.p_claim_token === A) return false;
      const job = jobs.find(j => j.id === ID)!;
      if (job.status !== 'succeeded') Object.assign(job, { status: 'succeeded', claim_expires_at: null });
      return true;
    }
    jobs.push({ ...row(ID), ...body, order_id: TARGET.order, stripe_payment_intent_id: TARGET.pi,
      status: 'pending', attempt_count: 0 });
    return structuredClone([jobs.at(-1)]);
  };
  return { order, jobs, calls, logs, waits, api, setFault: (f: typeof fault) => { fault = f; },
    run: (approval = APPROVAL) => runLeaseProof({ api, approval, uuid: () => ID, now: () => now,
      sleep: async ms => { waits.push(ms); now += ms; }, report: message => logs.push(message) }) };
}

test('real expiry duration, fenced completion/replay, unchanged order and fixture-only deletion', async () => {
  const s = sandbox(); await s.run();
  expect(s.waits).toEqual([305000]);
  expect(s.calls.filter(c => c.path.startsWith('rpc/fn_claim')).map(c => c.body)).toEqual(
    Array(3).fill({ p_limit: 1, p_max_attempts: 3 }));
  expect(s.calls.filter(c => c.path.startsWith('rpc/fn_complete')).map(c => c.body?.p_claim_token)).toEqual([A, B, B]);
  expect(s.calls.filter(c => c.method === 'DELETE')).toHaveLength(1);
  expect(s.calls.find(c => c.method === 'DELETE')?.path).toContain(`id=eq.${ID}&order_id=eq.${TARGET.order}&stripe_payment_intent_id=eq.${TARGET.pi}`);
  expect(s.calls.some(c => c.method === 'PATCH')).toBe(false);
  expect(s.logs.at(-1)).toContain('PASS');
  expect(s.logs.join('')).not.toContain(A);
});
for (const mismatch of ['fee', 'status', 'pi', 'timestamp', 'active', 'collision', 'approval']) {
  test(`preflight ${mismatch} refuses all mutations`, async () => {
    const s = sandbox();
    if (mismatch === 'fee') s.order.actual_stripe_fee_cents = 1;
    if (mismatch === 'status') s.order.status = 'completed';
    if (mismatch === 'pi') s.order.stripe_payment_intent_id = 'pi_wrong';
    if (mismatch === 'timestamp') s.order.stripe_fee_reconciled_at = 'invalid';
    if (mismatch === 'active') s.jobs[0].status = 'processing';
    if (mismatch === 'collision') s.jobs[0].id = ID;
    await expect(s.run(mismatch === 'approval' ? '' : APPROVAL)).rejects.toThrow();
    expect(s.calls.every(c => c.method === 'GET')).toBe(true);
  });
}
for (const mode of ['wrong-claim', 'malformed-claim', 'malformed-completion', 'history-drift', 'order-drift', 'insert-ambiguous', 'cleanup-failed']) {
  test(`${mode} fails safely, cleanup never touches historical rows`, async () => {
    const s = sandbox(); let injected = false;
    s.setFault((path, method) => {
      if (mode === 'cleanup-failed' && method === 'DELETE') throw new Error('SECRET raw IO');
      if (injected) return;
      if (mode === 'insert-ambiguous' && method === 'POST' && !path.startsWith('rpc/')) { injected = true; throw new Error('SECRET'); }
      if (path.startsWith('rpc/fn_claim') && mode === 'wrong-claim') { injected = true; return [{ ...s.jobs[0], claim_token: A }]; }
      if (path.startsWith('rpc/fn_claim') && mode === 'malformed-claim') { injected = true; return { error: 'SECRET' }; }
      if (path.startsWith('rpc/fn_complete') && mode === 'malformed-completion') { injected = true; return 'false'; }
      if (path.startsWith('rpc/fn_complete') && mode === 'order-drift') { injected = true; s.order.updated_at = 'drift'; }
      if (path.startsWith('rpc/fn_claim') && mode === 'history-drift') { injected = true; s.jobs[0].updated_at = 'drift'; }
    });
    await expect(s.run()).rejects.toThrow();
    expect(s.logs.join('')).not.toContain('SECRET');
    expect(s.logs.at(-1) ?? '').not.toContain('PASS');
    expect(s.calls.filter(c => c.method === 'DELETE').every(c => c.path.includes(`id=eq.${ID}&order_id=eq.${TARGET.order}`))).toBe(true);
    if (mode === 'cleanup-failed') expect(s.logs.join('')).toContain('CLEANUP_UNCERTAIN');
  });
}
test('REST uses authentic headers; sanitizes transport, HTTP and JSON failures', async () => {
  for (const response of [new Response('SECRET', { status: 403 }), new Response('not-json'), new Response('{"error":"SECRET"}')]) {
    const api = createRestApi('https://example.supabase.co', 'SECRET', async (_url, init) => {
      expect(init?.headers).toMatchObject({ apikey: 'SECRET', Authorization: 'Bearer SECRET' });
      expect(init?.redirect).toBe('error'); return response;
    });
    await expect(api('orders?select=*')).rejects.toThrow('API_FAILED');
  }
  const api = createRestApi('https://example.supabase.co', 'SECRET', async () => { throw new Error('SECRET'); });
  await expect(api('orders?select=*')).rejects.toThrow('API_FAILED');
});
for (const mode of ['committed-insert-loss', 'before-expiry-claimed', 'same-reclaim-token', 'stale-accepted', 'current-refused', 'replay-mutated', 'delete-wrong-row', 'delete-no-effect', 'short-wait', 'new-external-job']) {
  test(`${mode}: failure cannot end in PASS`, async () => {
    const s = sandbox(); let claims = 0, completions = 0;
    s.setFault((path, method, body) => {
      if (method === 'POST' && !path.startsWith('rpc/') && mode === 'committed-insert-loss') {
        s.jobs.push({ ...s.jobs[0], ...body, id: ID, order_id: TARGET.order, stripe_payment_intent_id: TARGET.pi, status: 'pending', attempt_count: 0 });
        throw new Error('response lost SECRET');
      }
      if (path.startsWith('rpc/fn_claim')) {
        claims++;
        if (mode === 'before-expiry-claimed' && claims === 2) return [s.jobs[0]];
        if (mode === 'same-reclaim-token' && claims === 3) return [{ ...s.jobs.find(j => j.id === ID), attempt_count: 2, claim_token: A }];
        if (mode === 'new-external-job' && claims === 1) s.jobs.push({ ...s.jobs[0], id: '55555555-5555-4555-8555-555555555555', status: 'pending' });
      }
      if (path.startsWith('rpc/fn_complete')) {
        completions++;
        if (mode === 'stale-accepted' && completions === 1) return true;
        if (mode === 'current-refused' && completions === 2) return false;
        if (mode === 'replay-mutated' && completions === 3) s.jobs.find(j => j.id === ID)!.last_error = 'mutation';
      }
      if (method === 'DELETE' && mode === 'delete-wrong-row') return [s.jobs[0]];
      if (method === 'DELETE' && mode === 'delete-no-effect') return [];
    });
    if (mode === 'short-wait') {
      await expect(runLeaseProof({ api: s.api, approval: APPROVAL, uuid: () => ID,
        now: () => Date.parse('2026-10-07T00:00:00Z'), sleep: async () => {}, report: m => s.logs.push(m) })).rejects.toThrow();
    } else await expect(s.run()).rejects.toThrow();
    expect(s.logs.at(-1) ?? '').not.toContain('PASS');
    expect(s.logs.join('')).not.toContain('SECRET');
    if (mode === 'committed-insert-loss') expect(s.calls.some(c => c.method === 'DELETE')).toBe(true);
    expect(s.calls.filter(c => c.method === 'DELETE').every(c => c.path.includes(`id=eq.${ID}&order_id=eq.${TARGET.order}`))).toBe(true);
  });
}
test('timestamp compares instants, history compares entire rows independent of key order', async () => {
  const s = sandbox(); s.order.stripe_fee_reconciled_at = '2026-09-18T20:20:42.637-06:00';
  await s.run(); expect(s.logs.at(-1)).toContain('PASS');
});
for (const key of Object.keys(sandbox().order)) {
  test(`complete order requires ${key} even when nullable`, async () => {
    const s = sandbox();
    s.setFault(path => path.startsWith('orders?') ? [Object.fromEntries(Object.entries(s.order).filter(([name]) => name !== key))] : undefined);
    await expect(s.run()).rejects.toThrow('INVALID_ORDER_SHAPE');
    expect(s.calls.every(c => c.method === 'GET')).toBe(true);
  });
}
for (const [key, value] of [['updated_at', 'unchanged'], ['currency', 123], ['payment_processing', null],
  ['buyer_id', 'not-a-uuid'], ['total_amount', '100'], ['compensation_attempt_count', null], ['shipping_address', undefined]]) {
  test(`complete order rejects malformed ${key}`, async () => {
    const s = sandbox();
    s.setFault(path => path.startsWith('orders?') ? [{ ...s.order, [String(key)]: value }] : undefined);
    await expect(s.run()).rejects.toThrow('INVALID_ORDER_SHAPE');
    expect(s.calls.every(c => c.method === 'GET')).toBe(true);
  });
}
test('five-field order projection is not a full preservation baseline', async () => {
  const s = sandbox();
  s.setFault(path => path.startsWith('orders?') ? [{ id: TARGET.order, status: 'paid',
    stripe_payment_intent_id: TARGET.pi, actual_stripe_fee_cents: 6817, stripe_fee_reconciled_at: TARGET.at }] : undefined);
  await expect(s.run()).rejects.toThrow('INVALID_ORDER_SHAPE');
  expect(s.calls.every(c => c.method === 'GET')).toBe(true);
});
test('generated nullable/string/JSON contracts accept legacy values without new business restrictions', async () => {
  const s = sandbox();
  Object.assign(s.order, { buyer_id: '00000000-0000-0000-0000-000000000000', currency: '',
    compensation_state: 'legacy-state', payment_processing_reason: '', stripe_charge_id: 'legacy-reference',
    service_fee_amount: 1.25, cancellation_loss_cents: 0, shipping_address: [null, { legacy: true }],
    created_at: null, updated_at: null });
  await s.run(); expect(s.logs.at(-1)).toContain('PASS');
});
test('wrapper masks key, clears BSTR, restores environment, and forwards exit code', () => {
  const ps = readFileSync(new URL('./verify-stripe-fee-lease-recovery.ps1', import.meta.url), 'utf8');
  for (const required of ['-AsSecureString', 'ZeroFreeBSTR', 'finally', '$LASTEXITCODE', 'SetEnvironmentVariable', 'SUPABASE_URL']) expect(ps).toContain(required);
  expect(ps).not.toContain('ExecutionPolicy');
  expect(ps).not.toContain('Write-Host $env:');
});
