import type { Database, Tables } from '../packages/types/src/index';

export const TARGET = { order: 'dc690d2a-00cb-5b2b-a6d0-1b23172270da', pi: 'pi_3UHDprACloWdhaxv1KVev8sQ', at: '2026-09-19T02:20:42.637Z' };
export const APPROVAL = 'DEV_ONLY_CRON_PAUSED_PRODUCERS_QUIET';
type Job = Tables<'stripe_fee_reconciliation_jobs'>;
type Order = Tables<'orders'>;
type RPC = Database['public']['Functions'];
type Api = (path: string, method?: string, body?: Record<string, unknown>) => Promise<unknown>;
type FetchCall = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
type Options = { api: Api; approval: string; uuid: () => string; now: () => number;
  sleep: (ms: number) => Promise<void>; report: (message: string) => void };
const JOBS = 'stripe_fee_reconciliation_jobs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class ProofError extends Error {}
function check(ok: unknown, code: string): asserts ok { if (!ok) throw new ProofError(code); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function instant(value: unknown): number { return typeof value === 'string' ? Date.parse(value) : NaN; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return JSON.stringify(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return JSON.stringify(value);
}
function rows(value: unknown): Job[] {
  check(Array.isArray(value), 'INVALID_JOB_RESPONSE');
  for (const row of value) {
    check(object(row) && typeof row.id === 'string' && UUID.test(row.id) &&
      typeof row.order_id === 'string' && UUID.test(row.order_id) &&
      typeof row.stripe_payment_intent_id === 'string' && row.stripe_payment_intent_id.startsWith('pi_') &&
      ['pending', 'processing', 'succeeded', 'failed'].includes(String(row.status)) &&
      Number.isSafeInteger(row.attempt_count) && Number(row.attempt_count) >= 0 &&
      Number.isFinite(instant(row.created_at)) && Number.isFinite(instant(row.updated_at)) &&
      (row.claim_token === null || (typeof row.claim_token === 'string' && UUID.test(row.claim_token))) &&
      (row.claim_expires_at === null || Number.isFinite(instant(row.claim_expires_at))) &&
      (row.next_retry_at === null || Number.isFinite(instant(row.next_retry_at))) &&
      (row.last_error === null || typeof row.last_error === 'string'), 'INVALID_JOB_SHAPE');
  }
  check(new Set(value.map(row => row.id)).size === value.length, 'DUPLICATE_JOB_ID');
  return (value as Job[]).sort((a, b) => a.id.localeCompare(b.id));
}
type Validator = (value: unknown) => boolean;
const stringValue: Validator = value => typeof value === 'string';
const numberValue: Validator = value => typeof value === 'number' && Number.isFinite(value);
const nullable = (validate: Validator): Validator => value => value === null || validate(value);
const dateValue: Validator = value => Number.isFinite(instant(value));
// PostgreSQL UUID values need not use the fixture's RFC version/variant restrictions.
const idValue: Validator = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function jsonValue(value: unknown): boolean {
  if (value === null || stringValue(value) || numberValue(value) || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(jsonValue);
  return object(value) && Object.values(value).every(item => item === undefined || jsonValue(item));
}
const orderStatuses = { pending: true, paid: true, preparing: true, shipped: true, delivered: true,
  completed: true, cancelled: true, dispute: true, refunded: true } satisfies Record<Order['status'], boolean>;
const orderValidators = {
  actual_stripe_fee_cents: nullable(numberValue), buyer_id: idValue,
  cancellation_loss_cents: nullable(numberValue), compensation_attempt_count: numberValue,
  compensation_last_error: nullable(stringValue), compensation_lease_expires_at: nullable(dateValue),
  compensation_state: nullable(stringValue), completed_at: nullable(dateValue), created_at: nullable(dateValue),
  currency: nullable(stringValue), delivered_at: nullable(dateValue), id: idValue,
  next_compensation_retry_at: nullable(dateValue), payment_processing: (value: unknown) => typeof value === 'boolean',
  payment_processing_reason: nullable(stringValue), service_fee_amount: nullable(numberValue), shipping_address: jsonValue,
  status: (value: unknown) => typeof value === 'string' && Object.hasOwn(orderStatuses, value),
  stripe_charge_id: nullable(stringValue), stripe_fee_reconciled_at: nullable(dateValue),
  stripe_payment_intent_id: nullable(stringValue), stripe_refund_id: nullable(stringValue),
  stripe_transfer_group: nullable(stringValue), total_amount: numberValue, updated_at: nullable(dateValue),
} satisfies Record<keyof Order, Validator>;
function isOrder(value: unknown): value is Order {
  return object(value) && Object.entries(orderValidators).every(([key, validate]) =>
    Object.hasOwn(value, key) && validate(value[key]));
}
export function createRestApi(url: string, key: string, fetchImpl: FetchCall): Api {
  let endpoint: URL;
  try { endpoint = new URL(url); } catch { throw new ProofError('INVALID_CONFIG'); }
  check(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password &&
    endpoint.pathname === '/' && !endpoint.search && !endpoint.hash && key.trim() && !/[\r\n]/.test(key), 'INVALID_CONFIG');
  return async (path, method = 'GET', body) => {
    try {
      const response = await fetchImpl(`${endpoint.origin}/rest/v1/${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      const data: unknown = await response.json();
      if (object(data) && ('error' in data || 'code' in data || 'message' in data)) throw new Error();
      return data;
    } catch { throw new ProofError('API_FAILED'); }
  };
}

/** Global claims are not isolated: the human must keep all producers/workers quiet. */
export async function runLeaseProof(o: Options): Promise<void> {
  check(o.approval === APPROVAL, 'MAINTENANCE_ACK_REQUIRED');
  const id = o.uuid(); check(UUID.test(id), 'INVALID_FIXTURE_ID');
  const guard = `id=eq.${id}&order_id=eq.${TARGET.order}&stripe_payment_intent_id=eq.${TARGET.pi}`;
  const fixturePath = `${JOBS}?select=*&id=eq.${id}`;
  const inventory = async () => rows(await o.api(`${JOBS}?select=*&order=id.asc&limit=20`));
  const order = async (): Promise<Order> => {
    const data = await o.api(`orders?select=*&id=eq.${TARGET.order}`);
    check(Array.isArray(data) && data.length === 1 && object(data[0]), 'INVALID_ORDER_RESPONSE');
    const row = data[0];
    check(isOrder(row), 'INVALID_ORDER_SHAPE');
    check(row.id === TARGET.order && row.status === 'paid' && row.stripe_payment_intent_id === TARGET.pi &&
      row.actual_stripe_fee_cents === 6817 && instant(row.stripe_fee_reconciled_at) === instant(TARGET.at), 'ORDER_PREFLIGHT_MISMATCH');
    return row;
  };
  const baselineOrder = canonical(await order());
  const history = await inventory();
  check(history.length === 18 && history.every(j => j.status === 'succeeded' && j.order_id !== TARGET.order && j.id !== id), 'INVENTORY_PREFLIGHT_MISMATCH');
  const baselineHistory = canonical(history);
  check(rows(await o.api(fixturePath)).length === 0, 'FIXTURE_ALREADY_EXISTS');
  const emit = (stage: string, extra: Record<string, unknown> = {}) => o.report(JSON.stringify({ stage, ...extra }));
  const sameOrder = async () => check(canonical(await order()) === baselineOrder, 'ORDER_DRIFT');
  const state = async (expected?: Job): Promise<Job | undefined> => {
    const jobs = await inventory();
    check(canonical(jobs.filter(j => j.id !== id)) === baselineHistory, 'HISTORY_OR_EXTERNAL_JOBS_DRIFT');
    const fixture = jobs.find(j => j.id === id);
    check(!fixture || (fixture.order_id === TARGET.order && fixture.stripe_payment_intent_id === TARGET.pi), 'FIXTURE_IDENTITY_DRIFT');
    if (expected) check(canonical(fixture) === canonical(expected), 'FIXTURE_DRIFT');
    await sameOrder(); return fixture;
  };
  const claim = async (attempt: number): Promise<Job> => {
    const args: RPC['fn_claim_stripe_fee_reconciliation_jobs_leased']['Args'] = { p_limit: 1, p_max_attempts: 3 };
    const data = await o.api('rpc/fn_claim_stripe_fee_reconciliation_jobs_leased', 'POST', args);
    // Unexpected global claims remain untouched; existing external ownership needs investigation.
    check(Array.isArray(data) && data.length === 1 && object(data[0]) && data[0].id === id,
      'UNEXPECTED_CLAIM_HUMAN_INVESTIGATION');
    const job = rows(data)[0];
    check(job.order_id === TARGET.order && job.stripe_payment_intent_id === TARGET.pi &&
      job.status === 'processing' && job.attempt_count === attempt && job.claim_token && UUID.test(job.claim_token) &&
      instant(job.claim_expires_at) > o.now() && job.next_retry_at === null, 'INVALID_CLAIM');
    await state(job); return job;
  };
  const complete = async (token: string, expected: boolean) => {
    const args: RPC['fn_complete_stripe_fee_reconciliation_job_leased']['Args'] = {
      p_job_id: id, p_claim_token: token, p_actual_stripe_fee_cents: 6817, p_reconciled_at: TARGET.at,
    };
    check(await o.api('rpc/fn_complete_stripe_fee_reconciliation_job_leased', 'POST', args) === expected, 'INVALID_COMPLETION_RESULT');
  };
  let insertAttempted = false, failed = false, cleanupFailed = false;
  try {
    emit('FIXTURE_RESERVED', { fixtureId: id });
    const insert: Database['public']['Tables']['stripe_fee_reconciliation_jobs']['Insert'] = {
      id, order_id: TARGET.order, stripe_payment_intent_id: TARGET.pi, status: 'pending',
    };
    // Mark before IO: a lost insert response can still mean the known UUID committed.
    insertAttempted = true;
    const inserted = rows(await o.api(`${JOBS}?select=*`, 'POST', insert));
    check(inserted.length === 1 && inserted[0].id === id && inserted[0].status === 'pending' &&
      inserted[0].attempt_count === 0 && inserted[0].claim_token === null && inserted[0].claim_expires_at === null &&
      inserted[0].next_retry_at === null, 'INVALID_INSERT');
    await state(inserted[0]);
    const first = await claim(1);
    await state(first); // Immediately before global before-expiry claim.
    check(instant(first.claim_expires_at) > o.now(), 'BEFORE_EXPIRY_WINDOW_LOST');
    const args: RPC['fn_claim_stripe_fee_reconciliation_jobs_leased']['Args'] = { p_limit: 1, p_max_attempts: 3 };
    const excluded = await o.api('rpc/fn_claim_stripe_fee_reconciliation_jobs_leased', 'POST', args);
    check(Array.isArray(excluded) && excluded.length === 0, 'UNEXPECTED_CLAIM_HUMAN_INVESTIGATION');
    await state(first); emit('BEFORE_EXPIRY_CHECK_PASSED');
    emit('WAITING', { minutes: 305000 / 60000 });
    const started = o.now(); await o.sleep(305000);
    check(o.now() - started >= 305000, 'WAIT_TOO_SHORT');
    await state(first);
    check(instant(first.claim_expires_at) <= o.now(), 'LEASE_NOT_EXPIRED');
    const second = await claim(2);
    check(second.claim_token !== first.claim_token, 'TOKEN_NOT_REPLACED');
    await complete(first.claim_token!, false); await state(second); emit('STALE_TOKEN_CHECK_PASSED');
    await complete(second.claim_token!, true);
    const succeeded = await state();
    check(succeeded?.status === 'succeeded' && succeeded.claim_token === second.claim_token &&
      succeeded.claim_expires_at === null && succeeded.attempt_count === 2, 'INVALID_SUCCESS_STATE');
    await complete(second.claim_token!, true); await state(succeeded); emit('REPLAY_CHECK_PASSED');
  } catch (error) {
    failed = true;
    emit('FAILED', { code: error instanceof ProofError ? error.message : 'IO_OR_CHECK_FAILED', cron: 'KEEP_PAUSED' });
  } finally {
    if (insertAttempted) {
      try {
        const deleted = rows(await o.api(`${JOBS}?select=*&${guard}`, 'DELETE'));
        check(deleted.length <= 1 && deleted.every(j => j.id === id && j.order_id === TARGET.order && j.stripe_payment_intent_id === TARGET.pi), 'INVALID_DELETE_RESPONSE');
        check(rows(await o.api(fixturePath)).length === 0, 'FIXTURE_NOT_REMOVED');
        check(await state() === undefined, 'CLEANUP_STATE_MISMATCH');
        emit('CLEANUP_VERIFIED');
      } catch {
        cleanupFailed = true;
        emit('CLEANUP_UNCERTAIN', { fixtureId: id, cron: 'KEEP_PAUSED', action: 'HUMAN_INVESTIGATION_REQUIRED' });
      }
    }
  }
  check(!failed && !cleanupFailed, 'PROOF_FAILED_KEEP_CRON_PAUSED');
  emit('PASS', { checks: 'lease_reclaim_stale_token_replay_preservation_cleanup', cron: 'MAINTAINER_ONLY', provider: 'NOT_TESTED' });
}

if (import.meta.main) {
  try {
    const api = createRestApi(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', fetch);
    await runLeaseProof({ api, approval: process.env.FEE_LEASE_APPROVAL ?? '', uuid: () => crypto.randomUUID(),
      now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), report: console.log });
  } catch {
    console.log(JSON.stringify({ stage: 'EXIT_FAILED', cron: 'KEEP_PAUSED' })); process.exitCode = 1;
  }
}
