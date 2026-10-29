import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ClosureCleanupUpdate } from '../_shared/account-closure-cleanup.ts';
import type { CronMismatchReporter } from '../_shared/cron-auth.ts';
import {
  BATCH_SIZE,
  MAX_ATTEMPTS,
  MIN_IDLE_SECONDS,
  createAccountClosureCleanupHandler,
  type AccountClosureCleanupDeps,
} from './handler.ts';

const SECRET = 'cron-secret-value';
const U1 = '00000000-0000-4000-8000-0000000000a1';
const U2 = '00000000-0000-4000-8000-0000000000a2';
const U3 = '00000000-0000-4000-8000-0000000000a3';

const row = (userId: string, overrides: Record<string, unknown> = {}) => ({
  user_id: userId,
  stripe_customer_id: 'cus_1',
  stripe_account_id: 'acct_1',
  stripe_customer_cleanup: 'failed',
  stripe_account_cleanup: 'not_needed',
  storage_cleanup: 'pending',
  attempts: 2,
  ...overrides,
});

type DbError = { code?: string; message: string } | null;

function harness(
  overrides: {
    secret?: string | undefined;
    rows?: Record<string, unknown>[] | null;
    claimError?: DbError;
    capped?: { user_id: string; attempts: number }[] | null;
    cappedError?: DbError;
    customer?: (id: string) => Error | undefined;
    storage?: (userId: string) => Error | undefined;
    record?: Error;
    reporter?: CronMismatchReporter;
  } = {},
) {
  const claimCalls: { limit: number; minIdleSeconds: number; maxAttempts: number }[] = [];
  const cappedCalls: { maxAttempts: number; limit: number }[] = [];
  const customerCalls: string[] = [];
  const accountCalls: string[] = [];
  const storageCalls: string[] = [];
  const records: { userId: string; update: ClosureCleanupUpdate }[] = [];
  const logs: { level: string; msg: string; data?: Record<string, unknown> }[] = [];
  const reports: { message: string; options: { fingerprint: string[]; tags: Record<string, string> } }[] = [];
  const deps: AccountClosureCleanupDeps = {
    getCronSecret: () => ('secret' in overrides ? overrides.secret : SECRET),
    claimClosures: async (limit, minIdleSeconds, maxAttempts) => {
      claimCalls.push({ limit, minIdleSeconds, maxAttempts });
      return { data: overrides.rows === undefined ? [] : overrides.rows, error: overrides.claimError ?? null };
    },
    listCappedClosures: async (maxAttempts, limit) => {
      cappedCalls.push({ maxAttempts, limit });
      return { data: overrides.capped ?? [], error: overrides.cappedError ?? null };
    },
    deleteStripeCustomer: async (id) => {
      customerCalls.push(id);
      const error = overrides.customer?.(id);
      if (error) throw error;
    },
    deleteStripeAccount: async (id) => {
      accountCalls.push(id);
    },
    removeStorageFiles: async (userId) => {
      storageCalls.push(userId);
      const error = overrides.storage?.(userId);
      if (error) throw error;
    },
    recordCleanup: async (userId, update) => {
      records.push({ userId, update });
      if (overrides.record) throw overrides.record;
    },
    log: (level, msg, data) => {
      logs.push({ level, msg, data });
    },
    reportMessage:
      overrides.reporter ??
      ((message, options) => {
        reports.push({ message, options });
      }),
  };
  return {
    handler: createAccountClosureCleanupHandler(deps),
    claimCalls,
    cappedCalls,
    customerCalls,
    accountCalls,
    storageCalls,
    records,
    logs,
    reports,
  };
}

const call = (
  h: ReturnType<typeof harness>,
  init: { method?: string; secret?: string | null } = {},
) =>
  h.handler(
    new Request('http://localhost/functions/v1/account-closure-cleanup', {
      method: init.method ?? 'POST',
      headers: init.secret === null ? {} : { 'x-cron-secret': init.secret ?? SECRET },
    }),
  );

const EMPTY = { claimed: 0, completed: 0, failed: 0, invalid: 0, capped: [] };

describe('account-closure-cleanup: authentication', () => {
  it('401 CRON_UNAUTHORIZED without the header, touching nothing', async () => {
    const h = harness({ rows: [row(U1)] });
    const response = await call(h, { secret: null });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'CRON_UNAUTHORIZED' });
    expect(h.claimCalls).toEqual([]);
    expect(h.storageCalls).toEqual([]);
  });

  it('401 with a wrong secret', async () => {
    const h = harness();
    expect((await call(h, { secret: 'nope' })).status).toBe(401);
    expect(h.claimCalls).toEqual([]);
  });

  it('401 when no CRON_SECRET is configured, even for an empty header', async () => {
    const h = harness({ secret: undefined });
    expect((await call(h, { secret: '' })).status).toBe(401);
    expect(h.claimCalls).toEqual([]);
  });

  it('compares the secret in constant time through the shared helper', () => {
    const source = readFileSync(join(import.meta.dir, 'handler.ts'), 'utf8');
    expect(source).toContain("from '../_shared/cron-auth.ts'");
    expect(source).toContain('isAuthorizedCronRequest(req, deps.getCronSecret())');
    expect(source).not.toContain('supplied !== expected');
  });

  it('reports a wrong secret as a mismatch without the secret value', async () => {
    const h = harness();
    expect((await call(h, { secret: 'nope' })).status).toBe(401);
    expect(h.reports).toEqual([
      {
        message: 'account-closure-cleanup cron secret mismatch',
        options: {
          fingerprint: ['cron-secret-mismatch', 'account-closure-cleanup'],
          tags: { edge_function: 'account-closure-cleanup' },
        },
      },
    ]);
    expect(JSON.stringify(h.reports)).not.toContain('nope');
  });

  it('does not report a missing header, a correct secret or an unconfigured secret', async () => {
    const missing = harness();
    await call(missing, { secret: null });
    const valid = harness();
    await call(valid);
    const unset = harness({ secret: undefined });
    expect((await call(unset, { secret: '' })).status).toBe(401);
    expect([missing.reports, valid.reports, unset.reports]).toEqual([[], [], []]);
  });

  it('a throwing reporter does not change the 401', async () => {
    const h = harness({
      reporter: () => {
        throw new Error('sentry down');
      },
    });
    const response = await call(h, { secret: 'nope' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'CRON_UNAUTHORIZED' });
    expect(h.claimCalls).toEqual([]);
  });

  it('405 for anything but POST once authenticated', async () => {
    const h = harness();
    const response = await call(h, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(h.claimCalls).toEqual([]);
  });
});

describe('account-closure-cleanup: run', () => {
  it('claims with the fixed batch size, idle window and attempt cap, and reports an empty run', async () => {
    const h = harness();
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EMPTY);
    expect(h.claimCalls).toEqual([
      { limit: BATCH_SIZE, minIdleSeconds: MIN_IDLE_SECONDS, maxAttempts: MAX_ATTEMPTS },
    ]);
    expect(h.records).toEqual([]);
  });

  it('keeps the policy numbers deliberate: bounded batch, a window past the request limit, a day of hourly tries', () => {
    expect(BATCH_SIZE).toBeLessThanOrEqual(100);
    expect(MIN_IDLE_SECONDS).toBeGreaterThanOrEqual(5 * 60);
    expect(MAX_ATTEMPTS).toBe(24);
  });

  it('finishes each claimed closure without counting a second attempt', async () => {
    const h = harness({ rows: [row(U1), row(U2, { stripe_customer_cleanup: 'done', stripe_customer_id: null })] });
    const response = await call(h);
    expect(await response.json()).toEqual({ ...EMPTY, claimed: 2, completed: 2 });
    expect(h.customerCalls).toEqual(['cus_1']);
    expect(h.storageCalls).toEqual([U1, U2]);
    expect(h.records.filter((r) => 'attempt' in r.update)).toEqual([]);
    expect(h.records.filter((r) => 'finish' in r.update)).toEqual([
      { userId: U1, update: { finish: true, last_error: null } },
      { userId: U2, update: { finish: true, last_error: null } },
    ]);
    expect(h.records).toContainEqual({ userId: U1, update: { storage_cleanup: 'done' } });
  });

  it('retries only the open steps of a row', async () => {
    const h = harness({
      rows: [row(U1, { stripe_customer_cleanup: 'done', stripe_account_cleanup: 'failed', storage_cleanup: 'done' })],
    });
    await call(h);
    expect(h.customerCalls).toEqual([]);
    expect(h.accountCalls).toEqual(['acct_1']);
    expect(h.storageCalls).toEqual([]);
  });

  it('a failing row is reported and does not stop the batch', async () => {
    const h = harness({
      rows: [row(U1), row(U2), row(U3)],
      storage: (userId) => (userId === U2 ? new Error('bucket down for jane@example.com') : undefined),
    });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...EMPTY, claimed: 3, completed: 2, failed: 1 });
    expect(h.storageCalls).toEqual([U1, U2, U3]);
    expect(h.records).toContainEqual({ userId: U2, update: { storage_cleanup: 'failed' } });
    expect(h.records).toContainEqual({ userId: U2, update: { finish: true, last_error: 'storage:error' } });
    expect(JSON.stringify(h.logs)).not.toContain('jane@example.com');
  });

  it('a row that crashes outright counts as failed with a sanitized code and the batch goes on', async () => {
    const h = harness();
    // A failing step is recorded, not a crash; a throwing log sink escapes the step for real.
    const crashing = createAccountClosureCleanupHandler({
      getCronSecret: () => SECRET,
      claimClosures: async () => ({ data: [row(U1), row(U2)], error: null }),
      listCappedClosures: async () => ({ data: [], error: null }),
      deleteStripeCustomer: async () => {},
      deleteStripeAccount: async () => {},
      removeStorageFiles: async (userId) => {
        if (userId === U1) throw new Error('boom');
      },
      recordCleanup: async () => {},
      log: (level, msg, data) => {
        h.logs.push({ level, msg, data });
        if (level === 'WARN' && data?.userId === U1) throw new Error('log sink down');
      },
      reportMessage: (message, options) => {
        h.reports.push({ message, options });
      },
    });
    const response = await crashing(
      new Request('http://localhost/', { method: 'POST', headers: { 'x-cron-secret': SECRET } }),
    );
    expect(await response.json()).toEqual({ ...EMPTY, claimed: 2, completed: 1, failed: 1 });
    expect(h.logs.find((e) => e.msg === 'Account closure cleanup crashed')?.data).toEqual({
      userId: U1,
      code: 'error',
    });
  });

  it('counts a row with an unusable shape as invalid and skips it', async () => {
    const h = harness({ rows: [row(U1, { storage_cleanup: 'weird' }), { stripe_customer_cleanup: 'failed' }, row(U2)] });
    const response = await call(h);
    expect(await response.json()).toEqual({ ...EMPTY, claimed: 3, completed: 1, invalid: 2 });
    expect(h.storageCalls).toEqual([U2]);
  });
});

describe('account-closure-cleanup: Sentry reports', () => {
  it('reports each failed cleanup step by step and code, without ids or provider text', async () => {
    const h = harness({
      rows: [row(U1, { stripe_customer_cleanup: 'done', storage_cleanup: 'pending' }), row(U2)],
      storage: (userId) =>
        userId === U1 ? Object.assign(new Error('bucket down for jane@example.com'), { code: 'storage_down' }) : undefined,
      customer: () => Object.assign(new Error('card 4242 4242 4242 4242'), { code: 'rate_limit' }),
    });
    const response = await call(h);
    expect(await response.json()).toEqual({ ...EMPTY, claimed: 2, failed: 2 });
    expect(h.reports).toEqual([
      {
        message: 'account-closure-cleanup step failed',
        options: {
          fingerprint: ['account-closure-cleanup-step-failed', 'storage', 'storage_down'],
          tags: { edge_function: 'account-closure-cleanup', step: 'storage', code: 'storage_down' },
        },
      },
      {
        message: 'account-closure-cleanup step failed',
        options: {
          fingerprint: ['account-closure-cleanup-step-failed', 'stripe_customer', 'rate_limit'],
          tags: { edge_function: 'account-closure-cleanup', step: 'stripe_customer', code: 'rate_limit' },
        },
      },
    ]);
    const text = JSON.stringify(h.reports);
    for (const secret of [U1, U2, 'jane@example.com', '4242', 'cus_1', 'acct_1']) expect(text).not.toContain(secret);
  });

  it('reports a repeated step failure once per run, after every row was processed', async () => {
    const fingerprints: string[][] = [];
    const storageCallsAtReport: number[] = [];
    let storageCalls: string[] = [];
    const h = harness({
      rows: [row(U1), row(U2), row(U3)],
      storage: () => Object.assign(new Error('bucket down'), { code: 'storage_down' }),
      reporter: (_message, options) => {
        fingerprints.push(options.fingerprint);
        storageCallsAtReport.push(storageCalls.length);
      },
    });
    storageCalls = h.storageCalls;
    const response = await call(h);
    expect(await response.json()).toEqual({ ...EMPTY, claimed: 3, failed: 3 });
    expect(fingerprints).toEqual([['account-closure-cleanup-step-failed', 'storage', 'storage_down']]);
    expect(storageCallsAtReport).toEqual([3]);
  });

  it('reports nothing for a clean run', async () => {
    const h = harness({ rows: [row(U1)] });
    await call(h);
    expect(h.reports).toEqual([]);
  });

  it('reports closures that reached the attempt cap once per run, with the count only', async () => {
    const h = harness({ capped: [{ user_id: U1, attempts: MAX_ATTEMPTS }, { user_id: U3, attempts: MAX_ATTEMPTS }] });
    await call(h);
    expect(h.reports).toEqual([
      {
        message: 'account-closure-cleanup gave up on closures',
        options: {
          fingerprint: ['account-closure-cleanup-capped'],
          tags: { edge_function: 'account-closure-cleanup', capped: '2' },
        },
      },
    ]);
  });

  it('a throwing reporter changes neither the response nor the run', async () => {
    const h = harness({
      rows: [row(U1), row(U2)],
      storage: () => new Error('bucket down'),
      capped: [{ user_id: U3, attempts: MAX_ATTEMPTS }],
      reporter: () => {
        throw new Error('sentry down');
      },
    });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...EMPTY,
      claimed: 2,
      failed: 2,
      capped: [{ user_id: U3, attempts: MAX_ATTEMPTS }],
    });
    expect(h.storageCalls).toEqual([U1, U2]);
  });

  it('a rejecting async reporter does not change the response either', async () => {
    const h = harness({ rows: [row(U1)], storage: () => new Error('x'), reporter: () => Promise.reject(new Error('down')) });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...EMPTY, claimed: 1, failed: 1 });
  });
});

describe('account-closure-cleanup: capped closures', () => {
  it('reports closures that reached the cap and logs their ids for an admin', async () => {
    const h = harness({
      capped: [
        { user_id: U1, attempts: MAX_ATTEMPTS },
        { user_id: U3, attempts: MAX_ATTEMPTS },
      ],
    });
    const response = await call(h);
    expect(await response.json()).toEqual({
      ...EMPTY,
      capped: [
        { user_id: U1, attempts: MAX_ATTEMPTS },
        { user_id: U3, attempts: MAX_ATTEMPTS },
      ],
    });
    expect(h.cappedCalls).toHaveLength(1);
    expect(h.cappedCalls[0].maxAttempts).toBe(MAX_ATTEMPTS);
    const entry = h.logs.find((e) => e.msg === 'Account closure cleanup gave up');
    expect(entry?.level).toBe('ERROR');
    expect(entry?.data).toEqual({ count: 2, userIds: [U1, U3] });
  });

  it('logs nothing about capped rows when there are none', async () => {
    const h = harness();
    await call(h);
    expect(h.logs.some((e) => e.msg === 'Account closure cleanup gave up')).toBe(false);
  });

  it('a failed capped lookup is logged and does not fail the run', async () => {
    const h = harness({ rows: [row(U1)], cappedError: { code: '42P01', message: 'relation "secret_table" missing' } });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...EMPTY, claimed: 1, completed: 1 });
    expect(JSON.stringify(h.logs)).not.toContain('secret_table');
  });
});

describe('account-closure-cleanup: failures', () => {
  it('500 INTERNAL_ERROR when the claim fails, without the database text', async () => {
    const h = harness({ claimError: { code: 'XX000', message: 'relation "secret_table" exploded' } });
    const response = await call(h);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'INTERNAL_ERROR' });
    expect(text + JSON.stringify(h.logs)).not.toContain('secret_table');
    expect(h.storageCalls).toEqual([]);
  });

  it('500 INTERNAL_ERROR when the claim throws', async () => {
    const h = harness();
    const throwing = createAccountClosureCleanupHandler({
      ...({} as AccountClosureCleanupDeps),
      getCronSecret: () => SECRET,
      claimClosures: async () => {
        throw new Error('MISSING_SERVER_CONFIG');
      },
      log: (level, msg, data) => {
        h.logs.push({ level, msg, data });
      },
    });
    const response = await throwing(
      new Request('http://localhost/', { method: 'POST', headers: { 'x-cron-secret': SECRET } }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'INTERNAL_ERROR' });
  });
});

describe('account-closure-cleanup wiring (source contract)', () => {
  const root = join(import.meta.dir, '..', '..', '..');
  const index = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');

  it('is wrapped in withSentry under its folder name and reads CRON_SECRET', () => {
    expect(index).toContain("serve(withSentry('account-closure-cleanup',");
    expect(index).toContain("from '../_shared/sentry.ts'");
    expect(index).toContain("Deno.env.get('CRON_SECRET')");
  });

  it('claims through the atomic RPC with the service role and shares the cleanup module', () => {
    expect(index).toContain('fn_claim_account_closures');
    expect(index).toContain('createSupabaseClosurePorts');
    expect(index).toContain("from '../_shared/account-closure-cleanup.ts'");
    expect(index).toContain('createClient<Database>');
    expect(index).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('is declared in config.toml without JWT verification (cron secret instead)', () => {
    const config = readFileSync(join(root, 'supabase/config.toml'), 'utf8').replace(/\r\n/g, '\n');
    expect(config).toMatch(/\[functions\.account-closure-cleanup\]\nverify_jwt = false/);
  });

  it('is documented in go-live with an hourly schedule the watchdog supports', () => {
    const doc = readFileSync(join(root, 'docs/go-live.md'), 'utf8');
    expect(doc).toContain('account-closure-cleanup');
    expect(doc).toMatch(/account-closure-cleanup[^\n]*`0 \* \* \* \*`/);
    expect(doc).toContain('account_closure_cleanup_cron_secret');
    expect(doc).toContain("'0 * * * *'");
  });
});
