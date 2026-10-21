import { describe, expect, it } from 'bun:test';

import { createCronWatchdogHandler, type CronWatchdogDeps } from './handler';
import type { CronHealthRow } from './health';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const SECRET = 'expected-secret';

const healthyRow = (jobname: string): CronHealthRow => ({
  jobname,
  schedule: '*/5 * * * *',
  active: true,
  last_start: new Date(NOW.getTime() - 60_000).toISOString(),
  last_status: 'succeeded',
});

function setup(
  rpcResult: { data: CronHealthRow[] | null; error: { message: string } | null },
  secret: string | undefined = SECRET,
) {
  const messages: Array<{ message: string; fingerprint: string[]; tags: Record<string, string> }> = [];
  const logs: string[] = [];
  let rpcCalls = 0;
  let monitorRuns = 0;
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
    rpcCalls: () => rpcCalls,
    monitorRuns: () => monitorRuns,
  };
}

const post = (headers: Record<string, string> = {}) =>
  new Request('https://example.test/cron-watchdog', { method: 'POST', headers });

describe('cron-watchdog handler', () => {
  it('returns 401 without calling the RPC when the secret header is missing', async () => {
    const ctx = setup({ data: [], error: null });
    const response = await ctx.handler(post());

    expect(response.status).toBe(401);
    expect(ctx.rpcCalls()).toBe(0);
    expect(ctx.monitorRuns()).toBe(0);
    expect(ctx.messages).toHaveLength(0);
  });

  it('returns 401 without calling the RPC when the secret is wrong', async () => {
    const ctx = setup({ data: [], error: null });
    const response = await ctx.handler(post({ 'x-cron-secret': 'nope' }));

    expect(response.status).toBe(401);
    expect(ctx.rpcCalls()).toBe(0);
  });

  it('returns 401 when CRON_SECRET is not configured, even with an empty header', async () => {
    const ctx = setup({ data: [], error: null }, undefined);
    const response = await ctx.handler(post({ 'x-cron-secret': '' }));

    expect(response.status).toBe(401);
    expect(ctx.rpcCalls()).toBe(0);
  });

  it('returns 500 when the RPC fails, without leaking the error text', async () => {
    const ctx = setup({ data: null, error: { message: 'permission denied for schema cron' } });
    const response = await ctx.handler(post({ 'x-cron-secret': SECRET }));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('permission denied');
    expect(ctx.messages).toHaveLength(0);
  });

  it('returns 200 with an empty list and sends nothing to Sentry when healthy', async () => {
    const ctx = setup({ data: [healthyRow('a'), healthyRow('b')], error: null });
    const response = await ctx.handler(post({ 'x-cron-secret': SECRET }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checked: 2, unhealthy: [] });
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

  it('never includes schedules, commands or run messages in the response', async () => {
    const leaky = {
      ...healthyRow('zz-fail'),
      last_status: 'failed',
      command: 'select vault.secret',
      return_message: 'ERROR: secret detail',
    } as CronHealthRow;
    const ctx = setup({ data: [leaky], error: null });
    const body = await (await ctx.handler(post({ 'x-cron-secret': SECRET }))).text();

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
  });
});
