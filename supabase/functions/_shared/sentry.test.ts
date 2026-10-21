import { describe, expect, it } from 'bun:test';

import { createSentry, createSentryWrapper, type SentrySdk } from './sentry';

interface CaptureCall {
  kind: 'exception' | 'message';
  payload: unknown;
  level?: string;
  tags: Record<string, string>;
  fingerprint?: string[];
}

interface FakeSdkOptions {
  captureThrows?: boolean;
  flushThrows?: boolean;
  monitorThrows?: boolean;
}

function createFakeSdk(options: FakeSdkOptions = {}) {
  const initCalls: Array<Record<string, unknown>> = [];
  const captures: CaptureCall[] = [];
  const flushCalls: number[] = [];
  let currentTags: Record<string, string> = {};
  let currentFingerprint: string[] | undefined;
  const fingerprintCalls: string[][] = [];
  const monitorCalls: Array<{ slug: string; config: unknown }> = [];

  const sdk: SentrySdk = {
    init: (initOptions) => {
      initCalls.push(initOptions as unknown as Record<string, unknown>);
    },
    withScope: (callback) => {
      const previousTags = currentTags;
      currentTags = {};
      currentFingerprint = undefined;
      const scope = {
        setFingerprint: (fingerprint: string[]) => {
          fingerprintCalls.push(fingerprint);
          currentFingerprint = fingerprint;
        },
        setTag: (key: string, value: string) => {
          currentTags[key] = value;
        },
      };
      const result = callback(scope);
      if (result instanceof Promise) {
        return result.finally(() => {
          currentTags = previousTags;
        }) as typeof result;
      }
      currentTags = previousTags;
      return result;
    },
    captureException: (error) => {
      if (options.captureThrows) throw new Error('capture failed');
      captures.push({ kind: 'exception', payload: error, tags: { ...currentTags }, fingerprint: currentFingerprint });
      return 'event-id';
    },
    captureMessage: (message, level) => {
      if (options.captureThrows) throw new Error('capture failed');
      captures.push({ kind: 'message', payload: message, level, tags: { ...currentTags }, fingerprint: currentFingerprint });
      return 'event-id';
    },
    withMonitor: (slug, callback, config) => {
      if (options.monitorThrows) throw new Error('monitor failed');
      monitorCalls.push({ slug, config });
      return callback();
    },
    flush: async (timeout) => {
      flushCalls.push(timeout as number);
      if (options.flushThrows) throw new Error('flush failed');
      return true;
    },
  };

  return { sdk, initCalls, captures, flushCalls, fingerprintCalls, monitorCalls };
}

function setup(env: Record<string, string | undefined>, sdkOptions: FakeSdkOptions = {}) {
  const fake = createFakeSdk(sdkOptions);
  const logs: string[] = [];
  let loadCalls = 0;
  const withSentry = createSentryWrapper({
    getEnv: (name) => env[name],
    loadSdk: async () => {
      loadCalls += 1;
      return fake.sdk;
    },
    log: (message) => logs.push(message),
  });
  return { ...fake, logs, withSentry, loadCalls: () => loadCalls };
}

const DSN = 'https://public@o0.ingest.sentry.io/1';
const request = () =>
  new Request('https://example.test/fn?secret=1', {
    method: 'POST',
    headers: { authorization: 'Bearer x' },
    body: 'private-body',
  });

describe('withSentry', () => {
  it('passes through without loading the SDK when SENTRY_DSN is absent', async () => {
    const ctx = setup({});
    const response = new Response('ok', { status: 500 });
    const handler = ctx.withSentry('fn', () => response);

    expect(await handler(request())).toBe(response);
    expect(ctx.loadCalls()).toBe(0);
    expect(ctx.initCalls).toHaveLength(0);
    expect(ctx.captures).toHaveLength(0);
    expect(ctx.flushCalls).toHaveLength(0);
  });

  it('reports a 5xx response as an error message and returns the same Response', async () => {
    const ctx = setup({ SENTRY_DSN: DSN, SB_REGION: 'us-east-1', SB_EXECUTION_ID: 'exec-1' });
    const response = new Response('boom', { status: 502 });
    const handler = ctx.withSentry('stripe-webhooks', () => response);

    expect(await handler(request())).toBe(response);
    expect(ctx.captures).toEqual([
      {
        kind: 'message',
        payload: 'stripe-webhooks responded 502',
        level: 'error',
        fingerprint: ['edge-function-5xx', 'stripe-webhooks', '502'],
        tags: {
          edge_function: 'stripe-webhooks',
          'http.method': 'POST',
          'sb.region': 'us-east-1',
          'sb.execution_id': 'exec-1',
        },
      },
    ]);
    expect(ctx.flushCalls).toEqual([2000]);
    expect(await response.text()).toBe('boom');
  });

  it('does not call Sentry or flush for 2xx and 4xx responses', async () => {
    const ctx = setup({ SENTRY_DSN: DSN });
    const ok = new Response('ok', { status: 200 });
    const notFound = new Response('nope', { status: 404 });

    expect(await ctx.withSentry('fn', () => ok)(request())).toBe(ok);
    expect(await ctx.withSentry('fn', () => notFound)(request())).toBe(notFound);
    expect(ctx.captures).toHaveLength(0);
    expect(ctx.flushCalls).toHaveLength(0);
  });

  it('captures a thrown error, flushes and rethrows the same error', async () => {
    const ctx = setup({ SENTRY_DSN: DSN });
    const failure = new Error('handler exploded');
    const handler = ctx.withSentry('fn', async () => {
      throw failure;
    });

    await expect(handler(request())).rejects.toBe(failure);
    expect(ctx.captures).toHaveLength(1);
    expect(ctx.captures[0].kind).toBe('exception');
    expect(ctx.captures[0].payload).toBe(failure);
    expect(ctx.fingerprintCalls).toHaveLength(0);
    expect(ctx.flushCalls).toEqual([2000]);
  });

  it('rethrows synchronous handler errors unchanged', async () => {
    const ctx = setup({ SENTRY_DSN: DSN });
    const failure = new Error('sync');
    const handler = ctx.withSentry('fn', () => {
      throw failure;
    });

    await expect(handler(request())).rejects.toBe(failure);
    expect(ctx.captures).toHaveLength(1);
  });

  it('logs once and degrades to passthrough when the SDK fails to load', async () => {
    const logs: string[] = [];
    let loadCalls = 0;
    const withSentry = createSentryWrapper({
      getEnv: (name) => (name === 'SENTRY_DSN' ? DSN : undefined),
      loadSdk: async () => {
        loadCalls += 1;
        throw new Error('cannot resolve npm:@sentry/deno');
      },
      log: (message) => logs.push(message),
    });
    const response = new Response('boom', { status: 500 });
    const handler = withSentry('fn', () => response);

    expect(await handler(request())).toBe(response);
    expect(await handler(request())).toBe(response);
    expect(loadCalls).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(DSN);
  });

  it('degrades to passthrough when init throws', async () => {
    const ctx = setup({ SENTRY_DSN: DSN });
    ctx.sdk.init = () => {
      throw new Error(`bad dsn ${DSN}`);
    };
    const response = new Response('boom', { status: 500 });
    const handler = ctx.withSentry('fn', () => response);

    expect(await handler(request())).toBe(response);
    expect(await handler(request())).toBe(response);
    expect(ctx.captures).toHaveLength(0);
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]).not.toContain(DSN);
  });

  it('initializes once with the privacy-preserving options', async () => {
    const ctx = setup({ SENTRY_DSN: DSN });
    const handler = ctx.withSentry('fn', () => new Response('ok'));

    await Promise.all([handler(request()), handler(request()), handler(request())]);
    await handler(request());

    expect(ctx.loadCalls()).toBe(1);
    expect(ctx.initCalls).toHaveLength(1);
    expect(ctx.initCalls[0]).toMatchObject({
      dsn: DSN,
      defaultIntegrations: false,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      attachStacktrace: false,
      environment: 'production',
    });
  });

  it('uses SENTRY_ENVIRONMENT when set', async () => {
    const ctx = setup({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging' });
    await ctx.withSentry('fn', () => new Response('ok'))(request());

    expect(ctx.initCalls[0].environment).toBe('staging');
  });

  it('beforeSend strips user and request data', async () => {
    const ctx = setup({ SENTRY_DSN: DSN });
    await ctx.withSentry('fn', () => new Response('ok'))(request());

    const beforeSend = ctx.initCalls[0].beforeSend as (
      event: Record<string, unknown>,
    ) => Record<string, unknown>;
    const result = beforeSend({
      message: 'kept',
      user: { email: 'a@b.c', ip_address: '1.2.3.4' },
      request: { url: 'https://x', headers: { authorization: 'secret' }, data: 'body' },
    });

    expect(result).toEqual({ message: 'kept' });
  });

  it('never changes the response when capture throws', async () => {
    const ctx = setup({ SENTRY_DSN: DSN }, { captureThrows: true });
    const response = new Response('boom', { status: 500 });

    expect(await ctx.withSentry('fn', () => response)(request())).toBe(response);
  });

  it('never changes the thrown error when capture throws', async () => {
    const ctx = setup({ SENTRY_DSN: DSN }, { captureThrows: true });
    const failure = new Error('original');

    await expect(
      ctx.withSentry('fn', async () => {
        throw failure;
      })(request()),
    ).rejects.toBe(failure);
  });

  it('never changes the outcome when flush throws', async () => {
    const ctx = setup({ SENTRY_DSN: DSN }, { flushThrows: true });
    const response = new Response('boom', { status: 503 });

    expect(await ctx.withSentry('fn', () => response)(request())).toBe(response);
  });

  it('tags only allowed keys and skips absent values, without request data', async () => {
    const ctx = setup({ SENTRY_DSN: DSN });
    await ctx.withSentry('fn', () => new Response('boom', { status: 500 }))(request());

    expect(Object.keys(ctx.captures[0].tags).sort()).toEqual(['edge_function', 'http.method']);
    const serialized = JSON.stringify(ctx.captures);
    expect(ctx.captures[0].tags).not.toHaveProperty('function');
    expect(serialized).not.toContain('secret=1');
    expect(serialized).not.toContain('private-body');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('example.test');
  });
});

const MONITOR_CONFIG = {
  schedule: { type: 'crontab' as const, value: '*/15 * * * *' },
  checkinMargin: 5,
  maxRuntime: 5,
  timezone: 'UTC',
};

function setupClient(env: Record<string, string | undefined>, sdkOptions: FakeSdkOptions = {}) {
  const fake = createFakeSdk(sdkOptions);
  let loadCalls = 0;
  const sentry = createSentry({
    getEnv: (name) => env[name],
    loadSdk: async () => {
      loadCalls += 1;
      return fake.sdk;
    },
    log: () => {},
  });
  return { ...fake, sentry, loadCalls: () => loadCalls };
}

describe('reportMessage', () => {
  it('captures an error message with fingerprint and tags in an isolated scope, then flushes', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN });
    await ctx.sentry.reportMessage('cron job-a failed', {
      fingerprint: ['cron-unhealthy', 'job-a', 'failed'],
      tags: { 'cron.job': 'job-a', 'cron.reason': 'failed' },
    });
    await ctx.sentry.reportMessage('cron job-b overdue', {
      fingerprint: ['cron-unhealthy', 'job-b', 'overdue'],
      tags: { 'cron.job': 'job-b', 'cron.reason': 'overdue' },
    });

    expect(ctx.captures).toEqual([
      {
        kind: 'message',
        payload: 'cron job-a failed',
        level: 'error',
        fingerprint: ['cron-unhealthy', 'job-a', 'failed'],
        tags: { 'cron.job': 'job-a', 'cron.reason': 'failed' },
      },
      {
        kind: 'message',
        payload: 'cron job-b overdue',
        level: 'error',
        fingerprint: ['cron-unhealthy', 'job-b', 'overdue'],
        tags: { 'cron.job': 'job-b', 'cron.reason': 'overdue' },
      },
    ]);
    expect(ctx.flushCalls).toEqual([2000, 2000]);
  });

  it('is a no-op without SENTRY_DSN', async () => {
    const ctx = setupClient({});
    await ctx.sentry.reportMessage('m', { fingerprint: ['a'], tags: {} });

    expect(ctx.loadCalls()).toBe(0);
    expect(ctx.captures).toHaveLength(0);
    expect(ctx.flushCalls).toHaveLength(0);
  });

  it('never throws when capture or flush fails', async () => {
    const capture = setupClient({ SENTRY_DSN: DSN }, { captureThrows: true });
    await expect(
      capture.sentry.reportMessage('m', { fingerprint: ['a'], tags: {} }),
    ).resolves.toBeUndefined();
    const flush = setupClient({ SENTRY_DSN: DSN }, { flushThrows: true });
    await expect(
      flush.sentry.reportMessage('m', { fingerprint: ['a'], tags: {} }),
    ).resolves.toBeUndefined();
  });
});

describe('withMonitor', () => {
  it('runs the function inside the SDK monitor with the exact config, then flushes', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN });
    const result = await ctx.sentry.withMonitor('cron-watchdog', MONITOR_CONFIG, async () => 42);

    expect(result).toBe(42);
    expect(ctx.monitorCalls).toEqual([{ slug: 'cron-watchdog', config: MONITOR_CONFIG }]);
    expect(ctx.flushCalls).toEqual([2000]);
  });

  it('is a plain passthrough without SENTRY_DSN', async () => {
    const ctx = setupClient({});
    const result = await ctx.sentry.withMonitor('cron-watchdog', MONITOR_CONFIG, async () => 'ok');

    expect(result).toBe('ok');
    expect(ctx.loadCalls()).toBe(0);
    expect(ctx.monitorCalls).toHaveLength(0);
    expect(ctx.flushCalls).toHaveLength(0);
  });

  it('propagates the function error unchanged', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN });
    const failure = new Error('run failed');

    await expect(
      ctx.sentry.withMonitor('cron-watchdog', MONITOR_CONFIG, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(ctx.flushCalls).toEqual([2000]);
  });

  it('still runs the function once when the SDK monitor fails', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN }, { monitorThrows: true });
    let runs = 0;
    const result = await ctx.sentry.withMonitor('cron-watchdog', MONITOR_CONFIG, async () => {
      runs += 1;
      return 'done';
    });

    expect(result).toBe('done');
    expect(runs).toBe(1);
  });

  it('never changes the result when flush throws', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN }, { flushThrows: true });

    expect(await ctx.sentry.withMonitor('cron-watchdog', MONITOR_CONFIG, async () => 'ok')).toBe('ok');
  });

  it('runs the function once when the SDK cannot load', async () => {
    const sentry = createSentry({
      getEnv: (name) => (name === 'SENTRY_DSN' ? DSN : undefined),
      loadSdk: async () => {
        throw new Error('cannot load');
      },
      log: () => {},
    });
    let runs = 0;
    await sentry.withMonitor('cron-watchdog', MONITOR_CONFIG, async () => {
      runs += 1;
    });

    expect(runs).toBe(1);
  });
});
