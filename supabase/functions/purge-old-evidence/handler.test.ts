import { describe, expect, it } from 'bun:test';

import type { CronMismatchReporter } from '../_shared/auth/cron-auth.ts';
import {
  BATCH_SIZE,
  STORAGE_PAGE_SIZE,
  createPurgeOldEvidenceHandler,
  createSupabasePurgeOldEvidencePorts,
  type PurgeOldEvidenceDeps,
} from './handler.ts';

const SECRET = 'cron-secret-value';
const O1 = '00000000-0000-4000-8000-0000000000b1';
const O2 = '00000000-0000-4000-8000-0000000000b2';
const O3 = '00000000-0000-4000-8000-0000000000b3';
const U1 = '00000000-0000-4000-8000-0000000000a1';

const path = (order: string, file: string) => `disputes/${order}/${U1}/${file}`;
const candidate = (order: string, names: string[]) => ({
  order_id: order,
  object_names: names,
});

type DbError = { code?: string; message: string } | null;

function harness(
  overrides: {
    secret?: string | undefined;
    rows?: unknown[] | null;
    listError?: DbError;
    listThrows?: Error;
    remove?: (paths: string[]) => Error | undefined;
    mark?: (orderId: string) => { data: boolean | null; error: DbError };
    reporter?: CronMismatchReporter;
  } = {},
) {
  const listCalls: number[] = [];
  const removeCalls: string[][] = [];
  const markCalls: string[] = [];
  const logs: { level: string; msg: string; data?: Record<string, unknown> }[] =
    [];
  const reports: {
    message: string;
    options: { fingerprint: string[]; tags: Record<string, string> };
  }[] = [];
  const deps: PurgeOldEvidenceDeps = {
    getCronSecret: () => ('secret' in overrides ? overrides.secret : SECRET),
    listCandidates: async (limit) => {
      listCalls.push(limit);
      if (overrides.listThrows) throw overrides.listThrows;
      return {
        data: overrides.rows === undefined ? [] : overrides.rows,
        error: overrides.listError ?? null,
      };
    },
    removeObjects: async (paths) => {
      removeCalls.push(paths);
      const error = overrides.remove?.(paths);
      if (error) throw error;
      return paths.length;
    },
    markPurged: async (orderId) => {
      markCalls.push(orderId);
      return overrides.mark?.(orderId) ?? { data: true, error: null };
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
    handler: createPurgeOldEvidenceHandler(deps),
    listCalls,
    removeCalls,
    markCalls,
    logs,
    reports,
  };
}

const call = (
  h: ReturnType<typeof harness>,
  init: { method?: string; secret?: string | null } = {},
) =>
  h.handler(
    new Request('http://localhost/functions/v1/purge-old-evidence', {
      method: init.method ?? 'POST',
      headers:
        init.secret === null ? {} : { 'x-cron-secret': init.secret ?? SECRET },
    }),
  );

const EMPTY = { orders: 0, removed: 0, marked: 0, failed: 0 };

describe('purge-old-evidence: authentication', () => {
  it('401 CRON_UNAUTHORIZED without the header, touching nothing', async () => {
    const h = harness({ rows: [candidate(O1, [path(O1, 'a.jpg')])] });
    const response = await call(h, { secret: null });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'CRON_UNAUTHORIZED' });
    expect([h.listCalls, h.removeCalls, h.markCalls]).toEqual([[], [], []]);
    expect(h.reports).toEqual([]);
  });

  it('401 with a wrong secret, reported as a mismatch without its value', async () => {
    const h = harness();
    const response = await call(h, { secret: 'nope' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'CRON_UNAUTHORIZED' });
    expect(h.listCalls).toEqual([]);
    expect(h.reports).toEqual([
      {
        message: 'purge-old-evidence cron secret mismatch',
        options: {
          fingerprint: ['cron-secret-mismatch', 'purge-old-evidence'],
          tags: { edge_function: 'purge-old-evidence' },
        },
      },
    ]);
    expect(JSON.stringify(h.reports)).not.toContain('nope');
  });

  it('401 when no CRON_SECRET is configured, even for an empty header', async () => {
    const h = harness({ secret: undefined });
    expect((await call(h, { secret: '' })).status).toBe(401);
    expect(h.listCalls).toEqual([]);
  });

  it('405 METHOD_NOT_ALLOWED for anything but POST once authenticated', async () => {
    const h = harness();
    const response = await call(h, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
    expect(h.listCalls).toEqual([]);
  });
});

describe('purge-old-evidence: run', () => {
  it('lists one bounded batch and answers an empty run', async () => {
    const h = harness();
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EMPTY);
    expect(h.listCalls).toEqual([BATCH_SIZE]);
    expect(BATCH_SIZE).toBe(50);
    expect(STORAGE_PAGE_SIZE).toBe(100);
    expect(h.logs).toContainEqual({
      level: 'INFO',
      msg: 'Evidence purge run finished',
      data: EMPTY,
    });
  });

  it("removes each order's objects, then marks it; an order without objects is only marked", async () => {
    const h = harness({
      rows: [
        candidate(O1, [path(O1, 'a.jpg'), path(O1, 'b.jpg')]),
        candidate(O2, []),
      ],
    });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orders: 2,
      removed: 2,
      marked: 2,
      failed: 0,
    });
    expect(h.removeCalls).toEqual([[path(O1, 'a.jpg'), path(O1, 'b.jpg')]]);
    expect(h.markCalls).toEqual([O1, O2]);
    expect(h.reports).toEqual([]);
  });

  it('removes in pages of at most 100 objects before marking', async () => {
    const names = Array.from({ length: 250 }, (_, i) => path(O1, `${i}.jpg`));
    const h = harness({ rows: [candidate(O1, names)] });
    expect(await (await call(h)).json()).toEqual({
      orders: 1,
      removed: 250,
      marked: 1,
      failed: 0,
    });
    expect(h.removeCalls.map((page) => page.length)).toEqual([100, 100, 50]);
    expect(h.removeCalls.flat()).toEqual(names);
    expect(h.markCalls).toEqual([O1]);
  });

  it('counts what Storage reports as removed, so a rerun of a removed order counts 0', async () => {
    const rerun = createPurgeOldEvidenceHandler({
      getCronSecret: () => SECRET,
      listCandidates: async () => ({
        data: [candidate(O1, [path(O1, 'a.jpg')])],
        error: null,
      }),
      removeObjects: async () => 0,
      markPurged: async () => ({ data: true, error: null }),
      log: () => {},
      reportMessage: () => {},
    });
    const response = await rerun(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'x-cron-secret': SECRET },
      }),
    );
    expect(await response.json()).toEqual({
      orders: 1,
      removed: 0,
      marked: 1,
      failed: 0,
    });
  });
});

describe('purge-old-evidence: failures', () => {
  it('a storage error fails that order unmarked, is reported with the order id only, and the run goes on', async () => {
    const secretPath = path(O2, 'jane@example.com.jpg');
    const h = harness({
      rows: [
        candidate(O1, [path(O1, 'a.jpg')]),
        candidate(O2, [secretPath]),
        candidate(O3, [path(O3, 'c.jpg')]),
      ],
      remove: (paths) =>
        paths.includes(secretPath)
          ? new Error(`bucket down for ${secretPath}`)
          : undefined,
    });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orders: 3,
      removed: 2,
      marked: 2,
      failed: 1,
    });
    expect(h.markCalls).toEqual([O1, O3]);
    expect(h.reports).toEqual([
      {
        message: 'purge-old-evidence order failed',
        options: {
          fingerprint: ['purge-old-evidence-order-failed', 'remove', 'error'],
          tags: {
            edge_function: 'purge-old-evidence',
            step: 'remove',
            code: 'error',
            order_id: O2,
            failed: '1',
          },
        },
      },
    ]);
    const text = JSON.stringify(h.reports) + JSON.stringify(h.logs);
    expect(text).not.toContain('jane@example.com');
    expect(text).not.toContain('disputes/');
  });

  it('a later page failing stops that order after the pages already removed', async () => {
    const names = Array.from({ length: 150 }, (_, i) => path(O1, `${i}.jpg`));
    let calls = 0;
    const h = harness({
      rows: [candidate(O1, names)],
      remove: () => (++calls === 2 ? new Error('timeout') : undefined),
    });
    expect(await (await call(h)).json()).toEqual({
      orders: 1,
      removed: 100,
      marked: 0,
      failed: 1,
    });
    expect(h.markCalls).toEqual([]);
  });

  it('a mark RPC error fails the order without the database text', async () => {
    const h = harness({
      rows: [candidate(O1, []), candidate(O2, [])],
      mark: (orderId) =>
        orderId === O1
          ? {
              data: null,
              error: {
                code: '57014',
                message: 'relation "secret_table" timeout',
              },
            }
          : { data: true, error: null },
    });
    expect(await (await call(h)).json()).toEqual({
      orders: 2,
      removed: 0,
      marked: 1,
      failed: 1,
    });
    expect(h.reports).toEqual([
      {
        message: 'purge-old-evidence order failed',
        options: {
          fingerprint: ['purge-old-evidence-order-failed', 'mark', '57014'],
          tags: {
            edge_function: 'purge-old-evidence',
            step: 'mark',
            code: '57014',
            order_id: O1,
            failed: '1',
          },
        },
      },
    ]);
    expect(JSON.stringify(h.reports) + JSON.stringify(h.logs)).not.toContain(
      'secret_table',
    );
  });

  it('a mark that returns false (the order no longer qualifies or objects remain) fails the order', async () => {
    const h = harness({
      rows: [candidate(O1, [path(O1, 'a.jpg')])],
      mark: () => ({ data: false, error: null }),
    });
    expect(await (await call(h)).json()).toEqual({
      orders: 1,
      removed: 1,
      marked: 0,
      failed: 1,
    });
    expect(h.reports[0]?.options.fingerprint).toEqual([
      'purge-old-evidence-order-failed',
      'mark',
      'not_marked',
    ]);
  });

  it('reports a repeated failure once per run with the count and the first order id', async () => {
    const h = harness({
      rows: [candidate(O1, [path(O1, 'a')]), candidate(O2, [path(O2, 'b')])],
      remove: () => Object.assign(new Error('down'), { code: 'storage_down' }),
    });
    expect(await (await call(h)).json()).toEqual({
      orders: 2,
      removed: 0,
      marked: 0,
      failed: 2,
    });
    expect(h.reports).toEqual([
      {
        message: 'purge-old-evidence order failed',
        options: {
          fingerprint: [
            'purge-old-evidence-order-failed',
            'remove',
            'storage_down',
          ],
          tags: {
            edge_function: 'purge-old-evidence',
            step: 'remove',
            code: 'storage_down',
            order_id: O1,
            failed: '2',
          },
        },
      },
    ]);
    expect(h.logs).toContainEqual({
      level: 'WARN',
      msg: 'Evidence purge failed for an order',
      data: { orderId: O2, step: 'remove', code: 'storage_down' },
    });
  });

  it('a row with an unusable shape fails without touching Storage', async () => {
    const h = harness({
      rows: [
        { order_id: 'not-a-uuid', object_names: [] },
        { order_id: O2, object_names: 'x' },
        candidate(O3, []),
      ],
    });
    expect(await (await call(h)).json()).toEqual({
      orders: 3,
      removed: 0,
      marked: 1,
      failed: 2,
    });
    expect(h.removeCalls).toEqual([]);
    expect(h.markCalls).toEqual([O3]);
    expect(h.reports[0]?.options.tags).toEqual({
      edge_function: 'purge-old-evidence',
      step: 'parse',
      code: 'invalid_row',
      order_id: 'unknown',
      failed: '2',
    });
  });

  it('a throwing reporter changes neither the response nor the run', async () => {
    const h = harness({
      rows: [candidate(O1, [path(O1, 'a')]), candidate(O2, [])],
      remove: () => new Error('down'),
      reporter: () => {
        throw new Error('sentry down');
      },
    });
    const response = await call(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orders: 2,
      removed: 0,
      marked: 1,
      failed: 1,
    });
  });

  it('500 INTERNAL_ERROR when the list RPC fails, without the database text', async () => {
    const h = harness({
      listError: { code: 'XX000', message: 'relation "secret_table" exploded' },
    });
    const response = await call(h);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'INTERNAL_ERROR' });
    expect(text + JSON.stringify(h.logs)).not.toContain('secret_table');
    expect([h.removeCalls, h.markCalls]).toEqual([[], []]);
  });

  it('500 INTERNAL_ERROR when the list throws (missing server config)', async () => {
    const h = harness({ listThrows: new Error('MISSING_SERVER_CONFIG') });
    const response = await call(h);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'INTERNAL_ERROR' });
  });
});

// The service-role client behind the real ports; records every call in order.
function fakeAdmin(
  options: {
    rpcResult?: { data: unknown; error: unknown };
    removeResult?: { data: unknown; error: unknown };
  } = {},
) {
  const calls: unknown[][] = [];
  const admin = {
    rpc: async (name: string, args: unknown) => {
      calls.push(['rpc', name, args]);
      return options.rpcResult ?? { data: [], error: null };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.push(['storage.remove', bucket, paths]);
          return (
            options.removeResult ?? {
              data: paths.map((name) => ({ name })),
              error: null,
            }
          );
        },
      }),
    },
    from: (table: string) => {
      calls.push(['from', table]);
      throw new Error(`unexpected table access: ${table}`);
    },
  };
  const ports = createSupabasePurgeOldEvidencePorts({
    getAdmin: () => admin as never,
  });
  return { calls, ports };
}

describe('purge-old-evidence Supabase ports', () => {
  it('lists through fn_list_evidence_purge_candidates', async () => {
    const { calls, ports } = fakeAdmin({
      rpcResult: { data: [candidate(O1, [])], error: null },
    });
    expect(await ports.listCandidates(50)).toEqual({
      data: [candidate(O1, [])],
      error: null,
    });
    expect(calls).toEqual([
      ['rpc', 'fn_list_evidence_purge_candidates', { p_limit: 50 }],
    ]);
  });

  it('removes through the Storage API on the evidence bucket and returns the removed count', async () => {
    const { calls, ports } = fakeAdmin();
    expect(await ports.removeObjects(['a', 'b'])).toBe(2);
    expect(calls).toEqual([['storage.remove', 'evidence', ['a', 'b']]]);
  });

  it('a Storage error throws', async () => {
    const { ports } = fakeAdmin({
      removeResult: { data: null, error: { message: 'down' } },
    });
    await expect(ports.removeObjects(['a'])).rejects.toThrow();
  });

  it('marks through fn_mark_evidence_purged', async () => {
    const { calls, ports } = fakeAdmin({
      rpcResult: { data: true, error: null },
    });
    expect(await ports.markPurged(O1)).toEqual({ data: true, error: null });
    expect(calls).toEqual([
      ['rpc', 'fn_mark_evidence_purged', { p_order_id: O1 }],
    ]);
  });
});
