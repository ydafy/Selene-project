import { describe, expect, it } from 'bun:test';

import {
  createCronWatchdogHandler,
  type CronWatchdogDeps,
  type OpsFailureEvent,
  type OpsFailureRow,
} from './handler';
import type { CronHealthRow } from './health';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const SECRET = 'expected-secret';

const healthyRow = (jobname: string): CronHealthRow => ({
  jobname,
  schedule: '*/5 * * * *',
  active: true,
  last_start: new Date(NOW.getTime() - 60_000).toISOString(),
  last_status: 'succeeded',
  last_http_failed_at: null,
  last_http_error: null,
});

const minutesAgo = (minutes: number): string =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

interface OpsFailureOptions {
  list?: {
    data: OpsFailureRow[] | null;
    error: { message: string } | null;
  };
  /** Whether Sentry confirms delivery of the reported failures. */
  delivered?: boolean;
  deleteResult?: { data: number | null; error: { message: string } | null };
}

function setup(
  rpcResult: {
    data: CronHealthRow[] | null;
    error: { message: string } | null;
  },
  secret: string | undefined = SECRET,
  ops: OpsFailureOptions = {},
) {
  const messages: Array<{
    message: string;
    fingerprint: string[];
    tags: Record<string, string>;
  }> = [];
  const logs: string[] = [];
  let rpcCalls = 0;
  let monitorRuns = 0;
  let listCalls = 0;
  const listLimits: number[] = [];
  const reportedBatches: OpsFailureEvent[][] = [];
  const deletedBatches: number[][] = [];
  const deps: CronWatchdogDeps = {
    getCronSecret: () => secret,
    now: () => NOW,
    fetchCronHealth: async () => {
      rpcCalls += 1;
      return rpcResult;
    },
    reportMessage: async (message, options) => {
      messages.push({ message, ...options });
    },
    listOpsFailures: async (limit) => {
      listCalls += 1;
      listLimits.push(limit);
      return ops.list ?? { data: [], error: null };
    },
    reportOpsFailures: async (events) => {
      reportedBatches.push(events);
      return ops.delivered ?? true;
    },
    deleteOpsFailures: async (ids) => {
      deletedBatches.push(ids);
      return ops.deleteResult ?? { data: ids.length, error: null };
    },
    runMonitored: async (fn) => {
      monitorRuns += 1;
      return fn();
    },
    log: (message) => logs.push(message),
  };
  return {
    handler: createCronWatchdogHandler(deps),
    messages,
    logs,
    reportedBatches,
    deletedBatches,
    listLimits,
    rpcCalls: () => rpcCalls,
    listCalls: () => listCalls,
    monitorRuns: () => monitorRuns,
  };
}

const failureRow = (
  id: number,
  source: string,
  code: string,
  context: Record<string, unknown> = {},
): OpsFailureRow => ({
  id,
  source,
  code,
  context,
  occurred_at: minutesAgo(id),
});

const post = (headers: Record<string, string> = {}) =>
  new Request('https://example.test/cron-watchdog', {
    method: 'POST',
    headers,
  });

describe('cron-watchdog handler', () => {
  it('returns 401 without calling the RPC or reporting when the secret header is missing', async () => {
    const ctx = setup({ data: [], error: null });
    const response = await ctx.handler(post());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'CRON_UNAUTHORIZED' });
    expect(ctx.rpcCalls()).toBe(0);
    expect(ctx.monitorRuns()).toBe(0);
    expect(ctx.messages).toHaveLength(0);
  });

  it('returns 401 without calling the RPC and reports the mismatch when the secret is wrong', async () => {
    const ctx = setup({ data: [], error: null });
    const response = await ctx.handler(post({ 'x-cron-secret': 'nope' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'CRON_UNAUTHORIZED' });
    expect(ctx.rpcCalls()).toBe(0);
    expect(ctx.monitorRuns()).toBe(0);
    expect(ctx.messages).toEqual([
      {
        message: 'cron-watchdog cron secret mismatch',
        fingerprint: ['cron-secret-mismatch', 'cron-watchdog'],
        tags: { edge_function: 'cron-watchdog' },
      },
    ]);
  });

  it('refuses a secret that only shares a prefix with CRON_SECRET', async () => {
    const ctx = setup({ data: [], error: null });
    const response = await ctx.handler(
      post({ 'x-cron-secret': `${SECRET}-extra` }),
    );

    expect(response.status).toBe(401);
    expect(ctx.rpcCalls()).toBe(0);
  });

  it('still returns 401 when the mismatch report fails', async () => {
    let rpcCalls = 0;
    const handler = createCronWatchdogHandler({
      getCronSecret: () => SECRET,
      now: () => NOW,
      fetchCronHealth: async () => {
        rpcCalls += 1;
        return { data: [], error: null };
      },
      reportMessage: async () => {
        throw new Error('Sentry down');
      },
      runMonitored: async (fn) => fn(),
      log: () => undefined,
    });
    const response = await handler(post({ 'x-cron-secret': 'nope' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'CRON_UNAUTHORIZED' });
    expect(rpcCalls).toBe(0);
  });

  it('returns 401 when CRON_SECRET is not configured, even with an empty header', async () => {
    const ctx = setup({ data: [], error: null }, undefined);
    const response = await ctx.handler(post({ 'x-cron-secret': '' }));

    expect(response.status).toBe(401);
    expect(ctx.rpcCalls()).toBe(0);
  });

  it('returns 500 when the RPC fails, without leaking the error text', async () => {
    const ctx = setup({
      data: null,
      error: { message: 'permission denied for schema cron' },
    });
    const response = await ctx.handler(post({ 'x-cron-secret': SECRET }));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('permission denied');
    expect(ctx.messages).toHaveLength(0);
    expect(ctx.listCalls()).toBe(0);
  });

  it('returns 200 with an empty list and sends nothing to Sentry when healthy', async () => {
    const ctx = setup({
      data: [healthyRow('a'), healthyRow('b')],
      error: null,
    });
    const response = await ctx.handler(post({ 'x-cron-secret': SECRET }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 2,
      unhealthy: [],
      opsFailures: { reported: 0, deleted: 0 },
    });
    expect(ctx.messages).toHaveLength(0);
    expect(ctx.rpcCalls()).toBe(1);
  });

  it('reports one Sentry message per unhealthy job and lists them in the response', async () => {
    const rows: CronHealthRow[] = [
      { ...healthyRow('zz-fail'), last_status: 'failed' },
      healthyRow('ok-job'),
      { ...healthyRow('weekly'), schedule: '0 9 * * 1' },
    ];
    const ctx = setup({ data: rows, error: null });
    const response = await ctx.handler(post({ 'x-cron-secret': SECRET }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 3,
      unhealthy: [
        { jobname: 'weekly', reason: 'unsupported-schedule' },
        { jobname: 'zz-fail', reason: 'failed' },
      ],
      opsFailures: { reported: 0, deleted: 0 },
    });
    expect(ctx.messages).toEqual([
      {
        message: 'cron weekly unsupported-schedule',
        fingerprint: ['cron-unhealthy', 'weekly', 'unsupported-schedule'],
        tags: { 'cron.job': 'weekly', 'cron.reason': 'unsupported-schedule' },
      },
      {
        message: 'cron zz-fail failed',
        fingerprint: ['cron-unhealthy', 'zz-fail', 'failed'],
        tags: { 'cron.job': 'zz-fail', 'cron.reason': 'failed' },
      },
    ]);
  });

  it('reports a recent HTTP failure with its error and time, and lists only its reason in the response', async () => {
    const rows: CronHealthRow[] = [
      {
        ...healthyRow('dispatch-push'),
        last_http_failed_at: minutesAgo(2),
        last_http_error: 'HTTP 503',
      },
      {
        ...healthyRow('old-failure'),
        last_http_failed_at: minutesAgo(90),
        last_http_error: 'HTTP 500',
      },
    ];
    const ctx = setup({ data: rows, error: null });
    const response = await ctx.handler(post({ 'x-cron-secret': SECRET }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 2,
      unhealthy: [{ jobname: 'dispatch-push', reason: 'http-failed' }],
      opsFailures: { reported: 0, deleted: 0 },
    });
    expect(ctx.messages).toEqual([
      {
        message: `cron dispatch-push http-failed: HTTP 503 at ${minutesAgo(2)}`,
        fingerprint: ['cron-unhealthy', 'dispatch-push', 'http-failed'],
        tags: { 'cron.job': 'dispatch-push', 'cron.reason': 'http-failed' },
      },
    ]);
  });

  it('removes URLs from the HTTP error it reports', async () => {
    const rows: CronHealthRow[] = [
      {
        ...healthyRow('purge'),
        last_http_failed_at: minutesAgo(1),
        last_http_error:
          'Could not resolve https://abc.supabase.co/functions/v1/purge?key=s3cret now',
      },
    ];
    const ctx = setup({ data: rows, error: null });
    await ctx.handler(post({ 'x-cron-secret': SECRET }));

    expect(ctx.messages.map((m) => m.message)).toEqual([
      `cron purge http-failed: Could not resolve [url] now at ${minutesAgo(1)}`,
    ]);
  });

  it('keeps the failed, overdue and unsupported-schedule reports unchanged', async () => {
    const oldHttpFailure = {
      last_http_failed_at: minutesAgo(60),
      last_http_error: 'HTTP 500',
    };
    const rows: CronHealthRow[] = [
      { ...healthyRow('a-failed'), ...oldHttpFailure, last_status: 'failed' },
      {
        ...healthyRow('b-late'),
        ...oldHttpFailure,
        last_start: minutesAgo(16),
      },
      { ...healthyRow('c-weekly'), ...oldHttpFailure, schedule: '0 9 * * 1' },
    ];
    const ctx = setup({ data: rows, error: null });
    const response = await ctx.handler(post({ 'x-cron-secret': SECRET }));

    expect(await response.json()).toEqual({
      checked: 3,
      unhealthy: [
        { jobname: 'a-failed', reason: 'failed' },
        { jobname: 'b-late', reason: 'overdue' },
        { jobname: 'c-weekly', reason: 'unsupported-schedule' },
      ],
      opsFailures: { reported: 0, deleted: 0 },
    });
    expect(ctx.messages.map((m) => m.message)).toEqual([
      'cron a-failed failed',
      'cron b-late overdue',
      'cron c-weekly unsupported-schedule',
    ]);
    expect(ctx.messages.map((m) => m.fingerprint)).toEqual([
      ['cron-unhealthy', 'a-failed', 'failed'],
      ['cron-unhealthy', 'b-late', 'overdue'],
      ['cron-unhealthy', 'c-weekly', 'unsupported-schedule'],
    ]);
  });

  it('never includes schedules, commands or run messages in the response', async () => {
    const leaky = {
      ...healthyRow('zz-fail'),
      last_status: 'failed',
      command: 'select vault.secret',
      return_message: 'ERROR: secret detail',
    } as CronHealthRow;
    const ctx = setup({ data: [leaky], error: null });
    const body = await (
      await ctx.handler(post({ 'x-cron-secret': SECRET }))
    ).text();

    expect(body).not.toContain('*/5');
    expect(body).not.toContain('vault');
    expect(body).not.toContain('secret detail');
  });

  it('rejects non-POST methods with 405 before touching the RPC', async () => {
    const ctx = setup({ data: [], error: null });
    const response = await ctx.handler(
      new Request('https://example.test/cron-watchdog', {
        method: 'GET',
        headers: { 'x-cron-secret': SECRET },
      }),
    );

    expect(response.status).toBe(405);
    expect(ctx.rpcCalls()).toBe(0);
    expect(ctx.listCalls()).toBe(0);
  });
});

describe('cron-watchdog ops failures (internal.ops_failures)', () => {
  const authorized = () => post({ 'x-cron-secret': SECRET });
  const failedJob = (): CronHealthRow => ({
    ...healthyRow('zz-fail'),
    last_status: 'failed',
  });

  it('reports each failure as one Sentry event after the health report, then deletes the reported ids', async () => {
    const ctx = setup({ data: [failedJob()], error: null }, SECRET, {
      list: {
        data: [
          failureRow(7, 'fn_cron_return_delivery_timeout', 'P0001', {
            dispute_id: 'd-1',
            error: 'boom',
          }),
          failureRow(9, 'fn_update_product_fts', '22001'),
        ],
        error: null,
      },
    });
    const response = await ctx.handler(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 1,
      unhealthy: [{ jobname: 'zz-fail', reason: 'failed' }],
      opsFailures: { reported: 2, deleted: 2 },
    });
    expect(ctx.messages.map((m) => m.message)).toEqual(['cron zz-fail failed']);
    expect(ctx.listLimits).toEqual([100]);
    expect(ctx.reportedBatches).toEqual([
      [
        {
          message: 'ops failure: fn_cron_return_delivery_timeout P0001',
          fingerprint: [
            'ops-failure',
            'fn_cron_return_delivery_timeout',
            'P0001',
          ],
          tags: {
            'ops.source': 'fn_cron_return_delivery_timeout',
            'ops.code': 'P0001',
          },
          extra: {
            ops_failure_id: 7,
            context: { dispute_id: 'd-1', error: 'boom' },
            occurred_at: minutesAgo(7),
          },
        },
        {
          message: 'ops failure: fn_update_product_fts 22001',
          fingerprint: ['ops-failure', 'fn_update_product_fts', '22001'],
          tags: { 'ops.source': 'fn_update_product_fts', 'ops.code': '22001' },
          extra: { ops_failure_id: 9, context: {}, occurred_at: minutesAgo(9) },
        },
      ],
    ]);
    expect(ctx.deletedBatches).toEqual([[7, 9]]);
  });

  it('sends nothing to Sentry and deletes nothing when there are no failures', async () => {
    const ctx = setup({ data: [healthyRow('a')], error: null }, SECRET, {
      list: { data: [], error: null },
    });
    const response = await ctx.handler(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 1,
      unhealthy: [],
      opsFailures: { reported: 0, deleted: 0 },
    });
    expect(ctx.listCalls()).toBe(1);
    expect(ctx.reportedBatches).toEqual([]);
    expect(ctx.deletedBatches).toEqual([]);
    expect(ctx.messages).toEqual([]);
  });

  it('reports a list error to Sentry without its text and still returns the health report', async () => {
    const ctx = setup({ data: [failedJob()], error: null }, SECRET, {
      list: {
        data: null,
        error: { message: 'permission denied for function x' },
      },
    });
    const response = await ctx.handler(authorized());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      checked: 1,
      unhealthy: [{ jobname: 'zz-fail', reason: 'failed' }],
      opsFailures: { error: 'OPS_FAILURES_LIST_FAILED' },
    });
    expect(body).not.toContain('permission denied');
    expect(ctx.messages).toEqual([
      {
        message: 'cron zz-fail failed',
        fingerprint: ['cron-unhealthy', 'zz-fail', 'failed'],
        tags: { 'cron.job': 'zz-fail', 'cron.reason': 'failed' },
      },
      {
        message: 'cron-watchdog could not list ops failures',
        fingerprint: ['ops-failures-list-failed'],
        tags: { edge_function: 'cron-watchdog' },
      },
    ]);
    expect(ctx.reportedBatches).toEqual([]);
    expect(ctx.deletedBatches).toEqual([]);
  });

  it('treats a list call that throws like a list error', async () => {
    const messages: string[][] = [];
    const handler = createCronWatchdogHandler({
      getCronSecret: () => SECRET,
      now: () => NOW,
      fetchCronHealth: async () => ({ data: [], error: null }),
      reportMessage: async (_message, options) => {
        messages.push(options.fingerprint);
      },
      listOpsFailures: async () => {
        throw new Error('network down');
      },
      reportOpsFailures: async () => true,
      deleteOpsFailures: async () => ({ data: 0, error: null }),
      runMonitored: async (fn) => fn(),
      log: () => undefined,
    });
    const response = await handler(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 0,
      unhealthy: [],
      opsFailures: { error: 'OPS_FAILURES_LIST_FAILED' },
    });
    expect(messages).toEqual([['ops-failures-list-failed']]);
  });

  it('keeps every row when Sentry does not confirm delivery (flush failed or timed out)', async () => {
    const ctx = setup({ data: [], error: null }, SECRET, {
      list: {
        data: [failureRow(3, 'fn_refresh_seller_stats', 'P0001')],
        error: null,
      },
      delivered: false,
    });
    const response = await ctx.handler(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 0,
      unhealthy: [],
      opsFailures: { error: 'OPS_FAILURES_NOT_DELIVERED' },
    });
    expect(ctx.reportedBatches).toHaveLength(1);
    expect(ctx.deletedBatches).toEqual([]);
    expect(ctx.logs).toEqual([
      'cron-watchdog: Sentry did not confirm 1 ops failures; kept for the next run',
    ]);
  });

  it('keeps every row when the reporter throws', async () => {
    let deleteCalls = 0;
    const handler = createCronWatchdogHandler({
      getCronSecret: () => SECRET,
      now: () => NOW,
      fetchCronHealth: async () => ({ data: [], error: null }),
      reportMessage: async () => undefined,
      listOpsFailures: async () => ({
        data: [failureRow(3, 'fn_x', 'X')],
        error: null,
      }),
      reportOpsFailures: async () => {
        throw new Error('sentry down');
      },
      deleteOpsFailures: async () => {
        deleteCalls += 1;
        return { data: 1, error: null };
      },
      runMonitored: async (fn) => fn(),
      log: () => undefined,
    });
    const response = await handler(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checked: 0,
      unhealthy: [],
      opsFailures: { error: 'OPS_FAILURES_NOT_DELIVERED' },
    });
    expect(deleteCalls).toBe(0);
  });

  it('reports a delete error to Sentry without its text and still returns the health report', async () => {
    const ctx = setup({ data: [], error: null }, SECRET, {
      list: { data: [failureRow(4, 'fn_x', 'X')], error: null },
      deleteResult: {
        data: null,
        error: { message: 'permission denied secret' },
      },
    });
    const response = await ctx.handler(authorized());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      checked: 0,
      unhealthy: [],
      opsFailures: { error: 'OPS_FAILURES_DELETE_FAILED' },
    });
    expect(body).not.toContain('permission denied');
    expect(ctx.deletedBatches).toEqual([[4]]);
    expect(ctx.messages).toEqual([
      {
        message: 'cron-watchdog could not delete reported ops failures',
        fingerprint: ['ops-failures-delete-failed'],
        tags: { edge_function: 'cron-watchdog' },
      },
    ]);
  });
});
