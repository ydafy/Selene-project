import { describe, expect, it } from 'bun:test';

import {
  acquireCheckoutRecoveryLease,
  releaseCheckoutRecoveryLease,
} from './lease.ts';

type Call = { fn: string; args: Record<string, unknown> };

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

function fakeWarn() {
  const warned: Array<Record<string, unknown>> = [];
  return { warned, warn: (data: Record<string, unknown>) => warned.push(data) };
}

const leaseId = '7e3a0000-0000-4000-8000-000000000013';

describe('acquireCheckoutRecoveryLease', () => {
  it('acquires the lease through the service-only RPC and returns its id', async () => {
    const { client, calls } = fakeClient({
      data: [{ acquired: true, lease_id: leaseId, lease_expires_at: '2026-10-26T00:10:00Z' }],
      error: null,
    });

    await expect(acquireCheckoutRecoveryLease(client)).resolves.toEqual({
      acquired: true,
      leaseId,
    });
    expect(calls).toEqual([{ fn: 'fn_acquire_checkout_recovery_lease', args: {} }]);
  });

  it('reports not acquired when another run holds the lease or recovery is disabled', async () => {
    const { client } = fakeClient({
      data: [{ acquired: false, lease_id: null, lease_expires_at: null }],
      error: null,
    });

    await expect(acquireCheckoutRecoveryLease(client)).resolves.toEqual({ acquired: false });
  });

  it('throws before any work when the RPC fails', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'permission denied' } });

    await expect(acquireCheckoutRecoveryLease(client)).rejects.toThrow(
      'CHECKOUT_RECOVERY_LOCK_ACQUIRE_FAILED: permission denied',
    );
  });

  it('throws when the RPC answers an acquired lease without an id', async () => {
    for (const data of [[], null, [{ acquired: true, lease_id: null }]]) {
      const { client } = fakeClient({ data, error: null });

      await expect(acquireCheckoutRecoveryLease(client)).rejects.toThrow(
        'CHECKOUT_RECOVERY_LOCK_ACQUIRE_FAILED: INVALID_LEASE_RESPONSE',
      );
    }
  });
});

describe('releaseCheckoutRecoveryLease', () => {
  it('releases the lease held by this run without warning', async () => {
    const { client, calls } = fakeClient({ data: true, error: null });
    const { warn, warned } = fakeWarn();

    await releaseCheckoutRecoveryLease(client, leaseId, warn);

    expect(calls).toEqual([
      { fn: 'fn_release_checkout_recovery_lease', args: { p_lease_id: leaseId } },
    ]);
    expect(warned).toEqual([]);
  });

  it('warns instead of throwing when this run no longer holds the lease', async () => {
    const { client } = fakeClient({ data: false, error: null });
    const { warn, warned } = fakeWarn();

    await releaseCheckoutRecoveryLease(client, leaseId, warn);

    expect(warned).toEqual([{ leaseId, reason: 'NOT_HOLDER' }]);
  });

  it('warns instead of throwing when the release RPC errors or rejects', async () => {
    for (const [result, reason] of [
      [{ data: null, error: { message: 'timeout' } }, 'timeout'],
      [new Error('network down'), 'network down'],
    ] as const) {
      const { client } = fakeClient(result);
      const { warn, warned } = fakeWarn();

      await releaseCheckoutRecoveryLease(client, leaseId, warn);

      expect(warned).toEqual([{ leaseId, reason }]);
    }
  });
});
