import { SQL } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const help =
  'Usage: bun scripts/verify/verify-stripe-fee-lease-recovery.ts [--help]\n' +
  'End to end: the Stripe fee reconciliation queue against the local stack. It creates its own\n' +
  'paid order without a charge, enqueues a job through fn_enqueue_stripe_fee_reconciliation_job\n' +
  '(true, then false for the same pair), runs reconcile-stripe-fees over HTTP (no charge, so the\n' +
  'job goes back to pending with one attempt and a future retry), then proves the lease: a\n' +
  'claimed job is not claimed again before its lease expires, an expired lease is reclaimed\n' +
  'with a new token, the stale token cannot complete it, the new one can, and a replay is a\n' +
  'no-op that answers true.\n' +
  'internal.stripe_fee_reconciliation_jobs is not exposed through PostgREST, so the setup, the\n' +
  'read-back, the lease expiry and the cleanup use a direct owner connection; the RPCs and the\n' +
  'worker go over HTTP with the local secret key and CRON_SECRET from bruno/.env\n' +
  '(`bun run bruno:env`). Needs `supabase start` and `bun run functions:serve`. Worker and claim\n' +
  'are global, so it refuses to start while any job is pending or processing. It deletes its\n' +
  'job and order at the end.\n' +
  'Database URL: SELENE_LOCAL_DB_URL, else `supabase status --env`. Only 127.0.0.1/localhost is accepted.';

const ROOT = join(import.meta.dir, '..', '..');
// Seeded fixture buyer (supabase/seed.sql).
const FIXTURE_BUYER = '00000000-0000-4000-8000-000000000005';
const FEE_CENTS = 6817;
const CLOCK_SKEW_MS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Job = {
  id: string;
  order_id: string;
  stripe_payment_intent_id: string;
  status: string;
  attempt_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  claim_token: string | null;
  claim_expires_at: string | null;
};

export type Ports = {
  db: {
    /** Jobs any worker or claim could pick up: pending or processing. */
    activeJobCount: () => Promise<number>;
    insertOrder: (orderId: string, paymentIntentId: string) => Promise<void>;
    jobs: (orderId: string) => Promise<Job[]>;
    makeDue: (jobId: string) => Promise<void>;
    expireClaim: (jobId: string) => Promise<void>;
    removeFixture: (orderId: string) => Promise<void>;
  };
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  runWorker: () => Promise<unknown>;
  uuid: () => string;
  now: () => number;
  report: (line: string) => void;
};

export class ProofError extends Error {}
function check(ok: unknown, code: string): asserts ok {
  if (!ok) throw new ProofError(code);
}
const instant = (value: string | null) =>
  value === null ? NaN : Date.parse(value);

// Never touch a remote project: this proof writes data.
export function requireLocal(url: string, what: string): string {
  if (!url) throw new Error(`No local ${what} URL found.`);
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost')
    throw new Error(`Refusing non-local ${what} host: ${host}`);
  return url;
}

/** Proves the queue, the worker's retry path and the lease recovery on a local fixture. */
export async function runFeeJobProof(p: Ports): Promise<void> {
  check((await p.db.activeJobCount()) === 0, 'ACTIVE_JOBS_PRESENT');
  const orderId = p.uuid();
  check(UUID.test(orderId), 'INVALID_FIXTURE_ID');
  const pi = `pi_verify_fee_${orderId.replaceAll('-', '')}`;
  const emit = (stage: string, extra: Record<string, unknown> = {}) =>
    p.report(JSON.stringify({ stage, ...extra }));
  const enqueue = () =>
    p.rpc('fn_enqueue_stripe_fee_reconciliation_job', {
      p_order_id: orderId,
      p_stripe_payment_intent_id: pi,
    });
  const claim = () =>
    p.rpc('fn_claim_stripe_fee_reconciliation_jobs_leased', {
      p_limit: 1,
      p_max_attempts: 3,
    });
  const complete = (jobId: string, token: string) =>
    p.rpc('fn_complete_stripe_fee_reconciliation_job_leased', {
      p_job_id: jobId,
      p_claim_token: token,
      p_actual_stripe_fee_cents: FEE_CENTS,
      p_reconciled_at: new Date(p.now()).toISOString(),
    });
  const only = async (): Promise<Job> => {
    const rows = await p.db.jobs(orderId);
    check(rows.length === 1, 'FIXTURE_JOB_COUNT');
    return rows[0];
  };
  const claimed = async (attempt: number): Promise<Job> => {
    const rows = await claim();
    check(Array.isArray(rows) && rows.length === 1, 'UNEXPECTED_CLAIM');
    const job = rows[0] as Job;
    check(
      job.order_id === orderId &&
        job.stripe_payment_intent_id === pi &&
        job.status === 'processing' &&
        job.attempt_count === attempt &&
        typeof job.claim_token === 'string' &&
        UUID.test(job.claim_token) &&
        instant(job.claim_expires_at) > p.now() &&
        job.next_retry_at === null,
      'INVALID_CLAIM',
    );
    return job;
  };

  let failed = false;
  let cleanupFailed = false;
  try {
    // Before the insert: a lost response can still mean the order committed.
    emit('FIXTURE_RESERVED', { orderId });
    await p.db.insertOrder(orderId, pi);

    check((await enqueue()) === true, 'ENQUEUE_NOT_INSERTED');
    check((await enqueue()) === false, 'REENQUEUE_NOT_IDEMPOTENT');
    const queued = await only();
    check(
      queued.status === 'pending' &&
        queued.attempt_count === 0 &&
        queued.claim_token === null &&
        queued.claim_expires_at === null &&
        queued.last_error === null &&
        instant(queued.next_retry_at) <= p.now() + CLOCK_SKEW_MS,
      'INVALID_ENQUEUED_JOB',
    );
    emit('ENQUEUE_CHECK_PASSED');

    const result = await p.runWorker();
    check(
      JSON.stringify(result) ===
        JSON.stringify({
          selected: 1,
          succeeded: 0,
          retryScheduled: 1,
          failed: 0,
          errors: 0,
        }),
      'WORKER_RESULT_MISMATCH',
    );
    const retried = await only();
    check(
      retried.status === 'pending' &&
        retried.attempt_count === 1 &&
        retried.last_error === 'STRIPE_FEE_UNAVAILABLE' &&
        retried.claim_token === null &&
        retried.claim_expires_at === null &&
        instant(retried.next_retry_at) > p.now() - CLOCK_SKEW_MS,
      'INVALID_RETRY_STATE',
    );
    emit('NO_CHARGE_RETRY_CHECK_PASSED');

    await p.db.makeDue(retried.id);
    const first = await claimed(2);
    const excluded = await claim();
    check(
      Array.isArray(excluded) && excluded.length === 0,
      'CLAIMED_BEFORE_EXPIRY',
    );
    emit('BEFORE_EXPIRY_CHECK_PASSED');

    await p.db.expireClaim(first.id);
    const second = await claimed(3);
    check(second.claim_token !== first.claim_token, 'TOKEN_NOT_REPLACED');
    check(
      (await complete(first.id, first.claim_token!)) === false,
      'STALE_TOKEN_ACCEPTED',
    );
    const stillClaimed = await only();
    check(
      stillClaimed.status === 'processing' &&
        stillClaimed.claim_token === second.claim_token,
      'STALE_TOKEN_CHANGED_JOB',
    );
    emit('STALE_TOKEN_CHECK_PASSED');

    check(
      (await complete(second.id, second.claim_token!)) === true,
      'COMPLETION_REJECTED',
    );
    const succeeded = await only();
    check(
      succeeded.status === 'succeeded' &&
        succeeded.attempt_count === 3 &&
        succeeded.claim_token === second.claim_token &&
        succeeded.claim_expires_at === null,
      'INVALID_SUCCESS_STATE',
    );
    check(
      (await complete(second.id, second.claim_token!)) === true,
      'REPLAY_REJECTED',
    );
    check(
      JSON.stringify(await only()) === JSON.stringify(succeeded),
      'REPLAY_CHANGED_JOB',
    );
    emit('REPLAY_CHECK_PASSED');
  } catch (error) {
    failed = true;
    emit('FAILED', {
      code: error instanceof ProofError ? error.message : 'IO_OR_CHECK_FAILED',
      detail: error instanceof ProofError ? undefined : String(error),
    });
  } finally {
    try {
      await p.db.removeFixture(orderId);
      check((await p.db.jobs(orderId)).length === 0, 'FIXTURE_NOT_REMOVED');
      emit('CLEANUP_VERIFIED');
    } catch {
      cleanupFailed = true;
      emit('CLEANUP_UNCERTAIN', { orderId });
    }
  }
  check(!failed && !cleanupFailed, 'PROOF_FAILED');
  emit('PASS', {
    checks:
      'enqueue_idempotency_no_charge_retry_lease_reclaim_stale_token_replay_cleanup',
  });
}

type Status = { DB_URL?: string; API_URL?: string; SECRET_KEY?: string };

function stackStatus(): Status {
  const status = Bun.spawnSync(['supabase', 'status', '--env'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (status.exitCode !== 0)
    throw new Error(
      'Local Supabase stack is not running for this worktree: run `supabase start`.',
    );
  const parsed = JSON.parse(status.stdout.toString()) as Record<
    string,
    unknown
  >;
  return (
    parsed.env && typeof parsed.env === 'object' ? parsed.env : parsed
  ) as Status;
}

function cronSecret(): string {
  const path = join(ROOT, 'bruno', '.env');
  const line = existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .find((entry) => entry.startsWith('CRON_SECRET='))
    : undefined;
  const value = line
    ?.slice('CRON_SECRET='.length)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\"/g, '"');
  if (!value)
    throw new Error(
      'CRON_SECRET is missing from bruno/.env: run `bun run bruno:env`.',
    );
  return value;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : (value as string | null);

function ownerDb(sql: SQL): Ports['db'] {
  return {
    activeJobCount: async () => {
      const [row] = await sql`
        SELECT count(*)::int AS n FROM internal.stripe_fee_reconciliation_jobs
        WHERE status IN ('pending', 'processing')`;
      return row.n as number;
    },
    insertOrder: async (orderId, paymentIntentId) => {
      await sql`
        INSERT INTO public.orders (
          id, buyer_id, total_amount_cents, shipping_address, status, stripe_payment_intent_id
        ) VALUES (
          ${orderId}, ${FIXTURE_BUYER}, 10000, '{}'::jsonb, 'paid', ${paymentIntentId}
        )`;
    },
    jobs: async (orderId) => {
      const rows = await sql`
        SELECT id, order_id, stripe_payment_intent_id, status, attempt_count, next_retry_at,
               last_error, claim_token, claim_expires_at
        FROM internal.stripe_fee_reconciliation_jobs WHERE order_id = ${orderId}`;
      return (rows as Record<string, unknown>[]).map((row) => ({
        ...(row as Job),
        next_retry_at: iso(row.next_retry_at),
        claim_expires_at: iso(row.claim_expires_at),
      }));
    },
    makeDue: async (jobId) => {
      await sql`
        UPDATE internal.stripe_fee_reconciliation_jobs
        SET next_retry_at = now() - interval '1 second'
        WHERE id = ${jobId} AND status = 'pending'`;
    },
    expireClaim: async (jobId) => {
      await sql`
        UPDATE internal.stripe_fee_reconciliation_jobs
        SET claim_expires_at = now() - interval '1 second'
        WHERE id = ${jobId} AND status = 'processing'`;
    },
    removeFixture: async (orderId) => {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM internal.stripe_fee_reconciliation_jobs WHERE order_id = ${orderId}`;
        await tx`DELETE FROM public.orders WHERE id = ${orderId}`;
      });
    },
  };
}

async function run() {
  const status = stackStatus();
  const dbUrl = requireLocal(
    process.env.SELENE_LOCAL_DB_URL ?? status.DB_URL ?? '',
    'database',
  );
  const apiUrl = requireLocal(status.API_URL ?? '', 'API');
  const secretKey = status.SECRET_KEY;
  if (!secretKey) throw new Error('No local SECRET_KEY in `supabase status`.');
  const secret = cronSecret();
  const sql = new SQL(dbUrl, { max: 2, connectionTimeout: 5 });
  try {
    await runFeeJobProof({
      db: ownerDb(sql),
      rpc: (name, args) =>
        postJson(
          `${apiUrl}/rest/v1/rpc/${name}`,
          { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
          args,
        ),
      runWorker: () =>
        postJson(
          `${apiUrl}/functions/v1/reconcile-stripe-fees`,
          { 'x-cron-secret': secret },
          {},
        ),
      uuid: () => crypto.randomUUID(),
      now: Date.now,
      report: console.log,
    });
  } finally {
    await sql.close();
  }
}

if (import.meta.main) {
  if (process.argv.includes('--help')) console.log(help);
  else
    await run().catch((error) => {
      console.log(
        JSON.stringify({ stage: 'EXIT_FAILED', reason: String(error) }),
      );
      process.exitCode = 1;
    });
}
