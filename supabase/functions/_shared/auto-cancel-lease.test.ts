import { describe, expect, it } from 'bun:test';

import {
  AUTO_CANCEL_RUN_BUDGET_MS,
  acquireAutoCancelLease,
  releaseAutoCancelLease,
} from './auto-cancel-lease';

type Call = { fn: string; args: Record<string, unknown> };
type Logged = { level: string; msg: string; data?: Record<string, unknown> };

function fakeClient(result: { data: unknown; error: unknown } | Error) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

function fakeLog() {
  const logged: Logged[] = [];
  return {
    logged,
    log: (level: Logged['level'], msg: string, data?: Record<string, unknown>) => {
      logged.push({ level, msg, data });
    },
  };
}

const leaseId = '7e3a0000-0000-4000-8000-000000000001';

describe('acquireAutoCancelLease', () => {
  it('acquires the job lease through the service-only RPC and returns its id', async () => {
    const { client, calls } = fakeClient({
      data: [{ acquired: true, lease_id: leaseId, lease_expires_at: '2026-10-23T03:10:00Z' }],
      error: null,
    });
    const { log } = fakeLog();

    const lease = await acquireAutoCancelLease(client, 'orders', log);

    expect(calls).toEqual([{ fn: 'fn_acquire_auto_cancel_lease', args: { p_job: 'orders' } }]);
    expect(lease.acquired).toBe(true);
    if (lease.acquired) expect(lease.leaseId).toBe(leaseId);
  });

  it('answers 200 Already running without work when another run holds the lease', async () => {
    const { client } = fakeClient({
      data: [{ acquired: false, lease_id: null, lease_expires_at: null }],
      error: null,
    });
    const { log, logged } = fakeLog();

    const lease = await acquireAutoCancelLease(client, 'preparing', log);

    expect(lease.acquired).toBe(false);
    if (lease.acquired) return;
    expect(lease.response.status).toBe(200);
    expect(await lease.response.json()).toEqual({ message: 'Already running' });
    expect(logged).toEqual([
      { level: 'WARN', msg: 'Auto-cancel lease held by another run; skipping', data: { job: 'preparing' } },
    ]);
  });

  it('fails closed with a stable code when the lease RPC errors, logging its code', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42883', message: 'function does not exist' } });
    const { log, logged } = fakeLog();

    await expect(acquireAutoCancelLease(client, 'orders', log)).rejects.toThrow(
      'AUTO_CANCEL_LEASE_UNAVAILABLE',
    );
    expect(logged).toEqual([
      {
        level: 'ERROR',
        msg: 'Auto-cancel lease could not be acquired',
        data: { job: 'orders', code: '42883', error: 'function does not exist' },
      },
    ]);
  });

  it('fails closed when the RPC returns no row or an acquired row without an id', async () => {
    for (const data of [null, [], [{ acquired: true, lease_id: null }]]) {
      const { client } = fakeClient({ data, error: null });
      await expect(acquireAutoCancelLease(client, 'orders', fakeLog().log)).rejects.toThrow(
        'AUTO_CANCEL_LEASE_UNAVAILABLE',
      );
    }
  });

  it('reports the run budget as exceeded only after AUTO_CANCEL_RUN_BUDGET_MS', async () => {
    const { client } = fakeClient({ data: [{ acquired: true, lease_id: leaseId }], error: null });
    let now = 1_000_000;

    const lease = await acquireAutoCancelLease(client, 'orders', fakeLog().log, () => now);

    if (!lease.acquired) throw new Error('expected an acquired lease');
    expect(AUTO_CANCEL_RUN_BUDGET_MS).toBe(100_000);
    now += AUTO_CANCEL_RUN_BUDGET_MS - 1;
    expect(lease.budgetExceeded()).toBe(false);
    now += 1;
    expect(lease.budgetExceeded()).toBe(true);
  });
});

describe('releaseAutoCancelLease', () => {
  it('releases the held lease by id', async () => {
    const { client, calls } = fakeClient({ data: true, error: null });
    const { log, logged } = fakeLog();

    await releaseAutoCancelLease(client, 'orders', leaseId, log);

    expect(calls).toEqual([
      { fn: 'fn_release_auto_cancel_lease', args: { p_job: 'orders', p_lease_id: leaseId } },
    ]);
    expect(logged).toEqual([]);
  });

  it('does nothing when no lease was acquired', async () => {
    const { client, calls } = fakeClient({ data: true, error: null });

    await releaseAutoCancelLease(client, 'orders', undefined, fakeLog().log);

    expect(calls).toEqual([]);
  });

  it('never throws on a lost or failed release: it warns and lets the lease expire', async () => {
    const cases: Array<[{ data: unknown; error: unknown } | Error, Record<string, unknown>]> = [
      [{ data: false, error: null }, { job: 'orders', leaseId, reason: 'NOT_HOLDER' }],
      [{ data: null, error: { code: 'PGRST301', message: 'timeout' } }, { job: 'orders', leaseId, reason: 'PGRST301' }],
      [new Error('network down'), { job: 'orders', leaseId, reason: 'network down' }],
    ];
    for (const [result, data] of cases) {
      const { client } = fakeClient(result);
      const { log, logged } = fakeLog();

      await releaseAutoCancelLease(client, 'orders', leaseId, log);

      expect(logged).toEqual([
        { level: 'WARN', msg: 'Auto-cancel lease not released; it expires on its own', data },
      ]);
    }
  });
});
