import { describe, expect, test } from 'bun:test';
import {
  type Job,
  type Ports,
  requireLocal,
  runFeeJobProof,
} from './verify-stripe-fee-lease-recovery';

const ORDER = '11111111-1111-4111-8111-111111111111';
const PI = `pi_verify_fee_${ORDER.replaceAll('-', '')}`;
const JOB = '22222222-2222-4222-8222-222222222222';
const TOKENS = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];

type Rpc = (args: Record<string, unknown>) => unknown;

/** An in-memory queue that follows the SQL contract of the four RPCs and the worker. */
function fake() {
  const now = Date.parse('2026-11-12T00:00:00Z');
  let jobs: Job[] = [];
  let orders: string[] = [];
  let tokens = 0;
  const calls: string[] = [];
  const logs: string[] = [];
  const due = (j: Job) =>
    (j.status === 'pending' &&
      (j.next_retry_at === null || Date.parse(j.next_retry_at) <= now)) ||
    (j.status === 'processing' && Date.parse(j.claim_expires_at!) <= now);
  const iso = (ms: number) => new Date(ms).toISOString();
  const claimOne = (): Job[] => {
    const job = jobs.find(due);
    if (!job) return [];
    Object.assign(job, {
      status: 'processing',
      attempt_count: job.attempt_count + 1,
      claim_token: TOKENS[tokens++ % 2],
      claim_expires_at: iso(now + 300_000),
      next_retry_at: null,
    });
    return [structuredClone(job)];
  };
  const rpcs: Record<string, Rpc> = {
    fn_enqueue_stripe_fee_reconciliation_job: (args) => {
      if (jobs.some((j) => j.order_id === args.p_order_id)) return false;
      jobs.push({
        id: JOB,
        order_id: String(args.p_order_id),
        stripe_payment_intent_id: String(args.p_stripe_payment_intent_id),
        status: 'pending',
        attempt_count: 0,
        next_retry_at: iso(now),
        last_error: null,
        claim_token: null,
        claim_expires_at: null,
      });
      return true;
    },
    fn_claim_stripe_fee_reconciliation_jobs_leased: claimOne,
    fn_complete_stripe_fee_reconciliation_job_leased: (args) => {
      const job = jobs.find((j) => j.id === args.p_job_id);
      if (!job || job.claim_token !== args.p_claim_token) return false;
      if (job.status === 'succeeded') return true;
      if (Date.parse(job.claim_expires_at!) <= now) return false;
      Object.assign(job, { status: 'succeeded', claim_expires_at: null });
      return true;
    },
  };
  const overrides: Record<string, Rpc> = {};
  const db: Ports['db'] = {
    activeJobCount: async () => {
      calls.push('db:activeJobCount');
      return jobs.filter((j) => ['pending', 'processing'].includes(j.status))
        .length;
    },
    insertOrder: async (orderId, pi) => {
      calls.push(`db:insertOrder:${orderId}:${pi}`);
      orders.push(orderId);
    },
    jobs: async (orderId) =>
      structuredClone(jobs.filter((j) => j.order_id === orderId)),
    makeDue: async (jobId) => {
      calls.push('db:makeDue');
      for (const j of jobs) if (j.id === jobId) j.next_retry_at = iso(now - 1);
    },
    expireClaim: async (jobId) => {
      calls.push('db:expireClaim');
      for (const j of jobs)
        if (j.id === jobId) j.claim_expires_at = iso(now - 1);
    },
    removeFixture: async (orderId) => {
      calls.push(`db:removeFixture:${orderId}`);
      jobs = jobs.filter((j) => j.order_id !== orderId);
      orders = orders.filter((id) => id !== orderId);
    },
  };
  const ports: Ports = {
    db,
    rpc: async (name, args) => {
      calls.push(`rpc:${name}`);
      return (overrides[name] ?? rpcs[name])(args);
    },
    runWorker: async () => {
      calls.push('worker');
      const claimed = claimOne();
      for (const c of claimed) {
        const job = jobs.find((j) => j.id === c.id)!;
        Object.assign(job, {
          status: 'pending',
          next_retry_at: iso(now + 60_000),
          last_error: 'STRIPE_FEE_UNAVAILABLE',
          claim_token: null,
          claim_expires_at: null,
        });
      }
      return {
        selected: claimed.length,
        succeeded: 0,
        retryScheduled: claimed.length,
        failed: 0,
        errors: 0,
      };
    },
    uuid: () => ORDER,
    now: () => now,
    report: (line) => logs.push(line),
  };
  return {
    ports,
    calls,
    logs,
    get jobs() {
      return jobs;
    },
    get orders() {
      return orders;
    },
    claimOne,
    seed: (job: Job) => jobs.push(job),
    override: (name: string, rpc: Rpc) => {
      overrides[name] = rpc;
    },
    stages: () => logs.map((line) => JSON.parse(line).stage as string),
  };
}

describe('runFeeJobProof', () => {
  test('passes the whole proof on a correct queue and removes its fixture', async () => {
    const f = fake();
    await runFeeJobProof(f.ports);
    expect(f.stages()).toEqual([
      'FIXTURE_RESERVED',
      'ENQUEUE_CHECK_PASSED',
      'NO_CHARGE_RETRY_CHECK_PASSED',
      'BEFORE_EXPIRY_CHECK_PASSED',
      'STALE_TOKEN_CHECK_PASSED',
      'REPLAY_CHECK_PASSED',
      'CLEANUP_VERIFIED',
      'PASS',
    ]);
    expect(f.calls).toEqual([
      'db:activeJobCount',
      `db:insertOrder:${ORDER}:${PI}`,
      'rpc:fn_enqueue_stripe_fee_reconciliation_job',
      'rpc:fn_enqueue_stripe_fee_reconciliation_job',
      'worker',
      'db:makeDue',
      'rpc:fn_claim_stripe_fee_reconciliation_jobs_leased',
      'rpc:fn_claim_stripe_fee_reconciliation_jobs_leased',
      'db:expireClaim',
      'rpc:fn_claim_stripe_fee_reconciliation_jobs_leased',
      'rpc:fn_complete_stripe_fee_reconciliation_job_leased',
      'rpc:fn_complete_stripe_fee_reconciliation_job_leased',
      'rpc:fn_complete_stripe_fee_reconciliation_job_leased',
      `db:removeFixture:${ORDER}`,
    ]);
    expect(f.jobs).toEqual([]);
    expect(f.orders).toEqual([]);
  });

  test('refuses to start, without writing, while another job is active', async () => {
    const f = fake();
    f.seed({
      id: '55555555-5555-4555-8555-555555555555',
      order_id: '66666666-6666-4666-8666-666666666666',
      stripe_payment_intent_id: 'pi_other',
      status: 'pending',
      attempt_count: 0,
      next_retry_at: null,
      last_error: null,
      claim_token: null,
      claim_expires_at: null,
    });
    await expect(runFeeJobProof(f.ports)).rejects.toThrow(
      'ACTIVE_JOBS_PRESENT',
    );
    expect(f.calls).toEqual(['db:activeJobCount']);
    expect(f.jobs).toHaveLength(1);
  });

  const failures: [string, string, Rpc][] = [
    ['an enqueue that does not insert', 'ENQUEUE_NOT_INSERTED', () => false],
    ['a re-enqueue that inserts again', 'REENQUEUE_NOT_IDEMPOTENT', () => true],
  ];
  for (const [name, code, rpc] of failures) {
    test(`fails on ${name} and still removes the fixture`, async () => {
      const f = fake();
      f.override('fn_enqueue_stripe_fee_reconciliation_job', rpc);
      await expect(runFeeJobProof(f.ports)).rejects.toThrow('PROOF_FAILED');
      expect(JSON.parse(f.logs.at(-2)!)).toEqual({ stage: 'FAILED', code });
      expect(f.stages().at(-1)).toBe('CLEANUP_VERIFIED');
      expect(f.calls.at(-1)).toBe(`db:removeFixture:${ORDER}`);
    });
  }

  test('fails when the stale token completes the job', async () => {
    const f = fake();
    f.override('fn_complete_stripe_fee_reconciliation_job_leased', () => true);
    await expect(runFeeJobProof(f.ports)).rejects.toThrow('PROOF_FAILED');
    expect(JSON.parse(f.logs.at(-2)!)).toEqual({
      stage: 'FAILED',
      code: 'STALE_TOKEN_ACCEPTED',
    });
    expect(f.jobs).toEqual([]);
  });

  test('fails when a claim returns a job before its lease expires', async () => {
    const f = fake();
    let claims = 0;
    f.override('fn_claim_stripe_fee_reconciliation_jobs_leased', () =>
      ++claims === 2 ? [{ id: JOB }] : f.claimOne(),
    );
    await expect(runFeeJobProof(f.ports)).rejects.toThrow('PROOF_FAILED');
    expect(JSON.parse(f.logs.at(-2)!)).toEqual({
      stage: 'FAILED',
      code: 'CLAIMED_BEFORE_EXPIRY',
    });
  });

  test('reports an uncertain cleanup and fails', async () => {
    const f = fake();
    f.ports.db.removeFixture = async () => {
      throw new Error('connection lost');
    };
    await expect(runFeeJobProof(f.ports)).rejects.toThrow('PROOF_FAILED');
    expect(JSON.parse(f.logs.at(-1)!)).toEqual({
      stage: 'CLEANUP_UNCERTAIN',
      orderId: ORDER,
    });
  });
});

describe('requireLocal', () => {
  test('accepts the local stack hosts', () => {
    expect(requireLocal('http://127.0.0.1:54321', 'API')).toBe(
      'http://127.0.0.1:54321',
    );
    expect(
      requireLocal('postgresql://postgres:postgres@localhost:5432/x', 'db'),
    ).toBe('postgresql://postgres:postgres@localhost:5432/x');
  });

  test('refuses a remote host and a missing URL', () => {
    expect(() => requireLocal('https://abcdefgh.supabase.co', 'API')).toThrow(
      'Refusing non-local API host: abcdefgh.supabase.co',
    );
    expect(() =>
      requireLocal(
        'postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres',
        'database',
      ),
    ).toThrow('Refusing non-local database host: db.abcdefgh.supabase.co');
    expect(() => requireLocal('', 'database')).toThrow(
      'No local database URL found.',
    );
  });
});
