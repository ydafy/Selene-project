import { describe, expect, it } from 'bun:test';

import { createSentry, createSentryWrapper, type SentrySdk } from './sentry';

interface CaptureCall {
  kind: 'exception' | 'message';
  payload: unknown;
  level?: string;
  tags: Record<string, string>;
  fingerprint?: string[];
  extra?: Record<string, unknown>;
}

/**
 * A fake of the SDK transport as @sentry/core 11.8.0 builds it: each captured
 * event becomes one request held in a promise buffer; when the buffer is full
 * the event is dropped and `afterSendEvent` fires with an empty response
 * (transports/base.ts); otherwise it fires with Sentry's HTTP status.
 */
interface FakeTransportOptions {
  /** HTTP status for the nth captured event (1-based); default 200. */
  status?: (n: number) => number;
  /** The nth event never gets a response (lost request). */
  noResponse?: (n: number) => boolean;
  /** Requests in flight at once; more are dropped. Default 64, as the SDK. */
  bufferSize?: number;
  /** Runs when the nth event is answered, before its hook fires. */
  onRespond?: (n: number) => void;
}

interface FakeSdkOptions {
  captureThrows?: boolean;
  flushThrows?: boolean;
  monitorThrows?: boolean;
  transport?: FakeTransportOptions;
}

type AfterSendEvent = (
  event: { event_id?: string },
  sendResponse: { statusCode?: number },
) => void;

function createFakeSdk(options: FakeSdkOptions = {}) {
  const initCalls: Array<Record<string, unknown>> = [];
  const captures: CaptureCall[] = [];
  const flushCalls: number[] = [];
  let currentTags: Record<string, string> = {};
  let currentFingerprint: string[] | undefined;
  let currentExtra: Record<string, unknown> = {};
  const fingerprintCalls: string[][] = [];
  const monitorCalls: Array<{ slug: string; config: unknown }> = [];
  const hooks = new Set<AfterSendEvent>();
  let eventCount = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const emit: AfterSendEvent = (event, response) => {
    for (const hook of [...hooks]) hook(event, response);
  };

  /** Returns the event id and, with a transport, sends the event. */
  const send = (): string => {
    eventCount += 1;
    const n = eventCount;
    const id = `event-${n}`;
    const transport = options.transport;
    if (!transport) return id;
    if (inFlight >= (transport.bufferSize ?? 64)) {
      queueMicrotask(() => emit({ event_id: id }, {}));
      return id;
    }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    setTimeout(() => {
      inFlight -= 1;
      if (transport.noResponse?.(n)) return;
      transport.onRespond?.(n);
      emit({ event_id: id }, { statusCode: transport.status?.(n) ?? 200 });
    }, 1);
    return id;
  };

  const sdk: SentrySdk = {
    init: (initOptions) => {
      initCalls.push(initOptions as unknown as Record<string, unknown>);
    },
    withScope: (callback) => {
      const previousTags = currentTags;
      currentTags = {};
      currentFingerprint = undefined;
      currentExtra = {};
      const scope = {
        setExtra: (key: string, value: unknown) => {
          currentExtra[key] = value;
        },
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
      captures.push({
        kind: 'exception',
        payload: error,
        tags: { ...currentTags },
        fingerprint: currentFingerprint,
      });
      return send();
    },
    captureMessage: (message, level) => {
      if (options.captureThrows) throw new Error('capture failed');
      captures.push({
        kind: 'message',
        payload: message,
        level,
        tags: { ...currentTags },
        fingerprint: currentFingerprint,
        ...(Object.keys(currentExtra).length > 0
          ? { extra: { ...currentExtra } }
          : {}),
      });
      return send();
    },
    getClient: () => ({
      on: (hook, callback) => {
        if (hook !== 'afterSendEvent') return () => undefined;
        hooks.add(callback);
        return () => {
          hooks.delete(callback);
        };
      },
    }),
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

  return {
    sdk,
    emit,
    hookCount: () => hooks.size,
    maxInFlight: () => maxInFlight,
    initCalls,
    captures,
    flushCalls,
    fingerprintCalls,
    monitorCalls,
  };
}

function setup(
  env: Record<string, string | undefined>,
  sdkOptions: FakeSdkOptions = {},
) {
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
    const ctx = setup({
      SENTRY_DSN: DSN,
      SB_REGION: 'us-east-1',
      SB_EXECUTION_ID: 'exec-1',
    });
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
    expect(await ctx.withSentry('fn', () => notFound)(request())).toBe(
      notFound,
    );
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

    await Promise.all([
      handler(request()),
      handler(request()),
      handler(request()),
    ]);
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
      request: {
        url: 'https://x',
        headers: { authorization: 'secret' },
        data: 'body',
      },
    });

    expect(result).toEqual({ message: 'kept' });
  });

  it('never changes the response when capture throws', async () => {
    const ctx = setup({ SENTRY_DSN: DSN }, { captureThrows: true });
    const response = new Response('boom', { status: 500 });

    expect(await ctx.withSentry('fn', () => response)(request())).toBe(
      response,
    );
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

    expect(await ctx.withSentry('fn', () => response)(request())).toBe(
      response,
    );
  });

  it('tags only allowed keys and skips absent values, without request data', async () => {
    const ctx = setup({ SENTRY_DSN: DSN });
    await ctx.withSentry(
      'fn',
      () => new Response('boom', { status: 500 }),
    )(request());

    expect(Object.keys(ctx.captures[0].tags).sort()).toEqual([
      'edge_function',
      'http.method',
    ]);
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

function setupClient(
  env: Record<string, string | undefined>,
  sdkOptions: FakeSdkOptions = {},
) {
  const fake = createFakeSdk(sdkOptions);
  let loadCalls = 0;
  const sentry = createSentry({
    getEnv: (name) => env[name],
    loadSdk: async () => {
      loadCalls += 1;
      return fake.sdk;
    },
    log: () => {},
    deliveryTimeoutMs: 50,
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

describe('reportMessagesDelivered', () => {
  const opsEvent = (n: number) => ({
    message: `ops failure: fn_${n} P0001`,
    fingerprint: ['ops-failure', `fn_${n}`, 'P0001'],
    tags: { 'ops.source': `fn_${n}`, 'ops.code': 'P0001' },
    extra: { ops_failure_id: n, context: { n } },
  });
  const events = (count: number) =>
    Array.from({ length: count }, (_, i) => opsEvent(i + 1));

  it('captures each event in its own scope and resolves true for each event Sentry answered with 2xx', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN }, { transport: {} });
    await expect(
      ctx.sentry.reportMessagesDelivered(events(2)),
    ).resolves.toEqual([true, true]);

    expect(ctx.captures).toEqual([
      {
        kind: 'message',
        payload: 'ops failure: fn_1 P0001',
        level: 'error',
        fingerprint: ['ops-failure', 'fn_1', 'P0001'],
        tags: { 'ops.source': 'fn_1', 'ops.code': 'P0001' },
        extra: { ops_failure_id: 1, context: { n: 1 } },
      },
      {
        kind: 'message',
        payload: 'ops failure: fn_2 P0001',
        level: 'error',
        fingerprint: ['ops-failure', 'fn_2', 'P0001'],
        tags: { 'ops.source': 'fn_2', 'ops.code': 'P0001' },
        extra: { ops_failure_id: 2, context: { n: 2 } },
      },
    ]);
    expect(ctx.hookCount()).toBe(0);
  });

  it('delivers 100 events through a 64-entry transport buffer, never more than 10 in flight', async () => {
    const ctx = setupClient(
      { SENTRY_DSN: DSN },
      { transport: { bufferSize: 64 } },
    );
    const result = await ctx.sentry.reportMessagesDelivered(events(100));

    expect(result).toEqual(Array(100).fill(true));
    expect(ctx.captures).toHaveLength(100);
    expect(ctx.maxInFlight()).toBe(10);
  });

  it('counts an event the full transport buffer dropped (empty response) as not delivered', async () => {
    const ctx = setupClient(
      { SENTRY_DSN: DSN },
      { transport: { bufferSize: 3 } },
    );
    const result = await ctx.sentry.reportMessagesDelivered(events(12));

    expect(result).toEqual([...Array(3).fill(true), ...Array(9).fill(false)]);
    // The first chunk failed, so the second chunk is never sent.
    expect(ctx.captures).toHaveLength(10);
  });

  it('counts HTTP 429 as not delivered', async () => {
    const ctx = setupClient(
      { SENTRY_DSN: DSN },
      { transport: { status: () => 429 } },
    );
    await expect(
      ctx.sentry.reportMessagesDelivered(events(2)),
    ).resolves.toEqual([false, false]);
  });

  it('counts HTTP 500 as not delivered', async () => {
    const ctx = setupClient(
      { SENTRY_DSN: DSN },
      { transport: { status: () => 500 } },
    );
    await expect(
      ctx.sentry.reportMessagesDelivered(events(1)),
    ).resolves.toEqual([false]);
  });

  it('keeps per-event results in a mixed chunk and stops before the next chunk', async () => {
    const ctx = setupClient(
      { SENTRY_DSN: DSN },
      { transport: { status: (n) => (n === 3 ? 500 : n === 7 ? 429 : 200) } },
    );
    const result = await ctx.sentry.reportMessagesDelivered(events(12));

    expect(result).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(ctx.captures).toHaveLength(10);
  });

  it('sends every chunk when each one succeeds', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN }, { transport: {} });
    const result = await ctx.sentry.reportMessagesDelivered(events(25));

    expect(result).toEqual(Array(25).fill(true));
    expect(ctx.captures).toHaveLength(25);
  });

  it('counts an event without a response before the timeout as not delivered', async () => {
    const ctx = setupClient(
      { SENTRY_DSN: DSN },
      { transport: { noResponse: (n) => n === 2 } },
    );
    await expect(
      ctx.sentry.reportMessagesDelivered(events(2)),
    ).resolves.toEqual([true, false]);
    expect(ctx.hookCount()).toBe(0);
  });

  it('ignores acknowledgements of events it did not capture', async () => {
    const ctx = setupClient(
      { SENTRY_DSN: DSN },
      {
        transport: {
          status: () => 500,
          // Another request's event answers 200 while ours are pending.
          onRespond: () =>
            fake.emit({ event_id: 'other' }, { statusCode: 200 }),
        },
      },
    );
    const fake = ctx;
    await expect(
      ctx.sentry.reportMessagesDelivered(events(2)),
    ).resolves.toEqual([false, false]);
  });

  it('resolves all false without SENTRY_DSN and never loads the SDK', async () => {
    const ctx = setupClient({});
    await expect(
      ctx.sentry.reportMessagesDelivered(events(2)),
    ).resolves.toEqual([false, false]);
    expect(ctx.loadCalls()).toBe(0);
    expect(ctx.captures).toHaveLength(0);
  });

  it('resolves all false, never throwing, when capture throws', async () => {
    const ctx = setupClient(
      { SENTRY_DSN: DSN },
      { captureThrows: true, transport: {} },
    );
    await expect(
      ctx.sentry.reportMessagesDelivered(events(2)),
    ).resolves.toEqual([false, false]);
    expect(ctx.hookCount()).toBe(0);
  });

  it('resolves all false when the SDK cannot load', async () => {
    const sentry = createSentry({
      getEnv: (name) => (name === 'SENTRY_DSN' ? DSN : undefined),
      loadSdk: async () => {
        throw new Error('load failed');
      },
      log: () => {},
    });
    await expect(sentry.reportMessagesDelivered(events(1))).resolves.toEqual([
      false,
    ]);
  });

  it('resolves an empty list without loading the SDK', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN });
    await expect(ctx.sentry.reportMessagesDelivered([])).resolves.toEqual([]);
    expect(ctx.loadCalls()).toBe(0);
  });
});

describe('withMonitor', () => {
  it('runs the function inside the SDK monitor with the exact config, then flushes', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN });
    const result = await ctx.sentry.withMonitor(
      'cron-watchdog',
      MONITOR_CONFIG,
      async () => 42,
    );

    expect(result).toBe(42);
    expect(ctx.monitorCalls).toEqual([
      { slug: 'cron-watchdog', config: MONITOR_CONFIG },
    ]);
    expect(ctx.flushCalls).toEqual([2000]);
  });

  it('is a plain passthrough without SENTRY_DSN', async () => {
    const ctx = setupClient({});
    const result = await ctx.sentry.withMonitor(
      'cron-watchdog',
      MONITOR_CONFIG,
      async () => 'ok',
    );

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
    const result = await ctx.sentry.withMonitor(
      'cron-watchdog',
      MONITOR_CONFIG,
      async () => {
        runs += 1;
        return 'done';
      },
    );

    expect(result).toBe('done');
    expect(runs).toBe(1);
  });

  it('never changes the result when flush throws', async () => {
    const ctx = setupClient({ SENTRY_DSN: DSN }, { flushThrows: true });

    expect(
      await ctx.sentry.withMonitor(
        'cron-watchdog',
        MONITOR_CONFIG,
        async () => 'ok',
      ),
    ).toBe('ok');
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
