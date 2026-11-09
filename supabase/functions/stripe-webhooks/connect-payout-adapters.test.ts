import { describe, expect, it } from 'bun:test';

import {
  appendConnectPayoutEventEvidence,
  attachConnectPayoutRunPayoutId,
  markConnectPayoutRunStatus,
  type SupabaseAdminClient,
} from './connect-payout-adapters.ts';

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: { message: string } | null };

// Records every query chain and RPC call, and answers each one with the next
// scripted result, in order.
function fakeClient(results: Result[]) {
  const queries: Call[][] = [];
  const rpcs: Array<{ name: string; args: unknown }> = [];
  const next = (): Result => {
    const result = results.shift();
    if (!result) throw new Error('unexpected database call');
    return result;
  };
  const builder = (calls: Call[]) => {
    const chain =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push([method, ...args]);
        return query;
      };
    const query = {
      update: chain('update'),
      select: chain('select'),
      eq: chain('eq'),
      is: chain('is'),
      in: chain('in'),
      maybeSingle: async () => {
        calls.push(['maybeSingle']);
        return next();
      },
      then: (resolve: (value: Result) => unknown) => resolve(next()),
    };
    return query;
  };
  const client = {
    from: (table: string) => {
      const calls: Call[] = [['from', table]];
      queries.push(calls);
      return builder(calls);
    },
    rpc: async (name: string, args: unknown) => {
      rpcs.push({ name, args });
      return next();
    },
  };
  return {
    client: client as unknown as SupabaseAdminClient,
    queries,
    rpcs,
  };
}

const attachInput = {
  runId: 'run-1',
  stripePayoutId: 'po_1',
  sellerId: 'seller-1',
};

const reRead = (row: unknown, error: Result['error'] = null): Result => ({
  data: row,
  error,
});

describe('attachConnectPayoutRunPayoutId', () => {
  it('attaches the payout id only to a recoverable run of the seller that has none', async () => {
    const fake = fakeClient([{ data: [{ id: 'run-1' }], error: null }]);
    const before = Date.now();

    await attachConnectPayoutRunPayoutId(fake.client, attachInput);

    expect(fake.queries).toHaveLength(1);
    const [from, update, ...filters] = fake.queries[0];
    expect(from).toEqual(['from', 'connect_payout_runs']);
    expect(update[0]).toBe('update');
    const payload = update[1] as {
      stripe_payout_id: string;
      updated_at: string;
    };
    expect(Object.keys(payload).sort()).toEqual([
      'stripe_payout_id',
      'updated_at',
    ]);
    expect(payload.stripe_payout_id).toBe('po_1');
    expect(Date.parse(payload.updated_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(payload.updated_at)).toBeLessThanOrEqual(Date.now());
    expect(filters).toEqual([
      ['eq', 'id', 'run-1'],
      ['eq', 'seller_id', 'seller-1'],
      ['is', 'stripe_payout_id', null],
      ['in', 'status', ['pending_reconciliation', 'reconciliation_needed']],
      ['select', 'id'],
    ]);
  });

  it('accepts a zero-row attach when the re-read run already holds the same payout id', async () => {
    const fake = fakeClient([
      { data: [], error: null },
      reRead({ id: 'run-1', seller_id: 'seller-1', stripe_payout_id: 'po_1' }),
    ]);

    await attachConnectPayoutRunPayoutId(fake.client, attachInput);

    expect(fake.queries).toHaveLength(2);
    expect(fake.queries[1]).toEqual([
      ['from', 'connect_payout_runs'],
      ['select', 'id, seller_id, stripe_payout_id'],
      ['eq', 'id', 'run-1'],
      ['maybeSingle'],
    ]);
  });

  it('rejects a zero-row attach when the re-read run holds a different payout id', async () => {
    const fake = fakeClient([
      { data: [], error: null },
      reRead({ id: 'run-1', seller_id: 'seller-1', stripe_payout_id: 'po_2' }),
    ]);

    await expect(
      attachConnectPayoutRunPayoutId(fake.client, attachInput),
    ).rejects.toThrow('PAYOUT_RUN_ATTACH_CONFLICT');
    expect(fake.queries).toHaveLength(2);
  });

  it.each([
    [
      'no payout id yet',
      reRead({ id: 'run-1', seller_id: 'seller-1', stripe_payout_id: null }),
    ],
    [
      'another seller',
      reRead({ id: 'run-1', seller_id: 'seller-2', stripe_payout_id: 'po_1' }),
    ],
    ['a missing run', reRead(null)],
    ['a failed lookup', reRead(null, { message: 'lookup down' })],
  ])('rejects a zero-row attach when the re-read shows %s', async (_, row) => {
    const fake = fakeClient([{ data: null, error: null }, row]);

    await expect(
      attachConnectPayoutRunPayoutId(fake.client, attachInput),
    ).rejects.toThrow('PAYOUT_RUN_ATTACH_CONFLICT');
  });

  it('propagates an update error without re-reading the run', async () => {
    const fake = fakeClient([{ data: null, error: { message: 'db down' } }]);

    await expect(
      attachConnectPayoutRunPayoutId(fake.client, attachInput),
    ).rejects.toThrow('PAYOUT_RUN_ATTACH_FAILED: db down');
    expect(fake.queries).toHaveLength(1);
  });

  it('rejects a run without a seller before touching the database', async () => {
    const fake = fakeClient([]);

    await expect(
      attachConnectPayoutRunPayoutId(fake.client, {
        ...attachInput,
        sellerId: null,
      }),
    ).rejects.toThrow('PAYOUT_RUN_ATTACH_CONFLICT');
    expect(fake.queries).toHaveLength(0);
  });
});

const terminalInput = {
  runId: 'run-1',
  payoutId: 'po_1',
  status: 'failed' as const,
  occurredAt: '2026-11-09T12:00:00.000Z',
  failureReason: 'account_closed',
  failureBalanceTransaction: 'txn_1',
};

describe('markConnectPayoutRunStatus', () => {
  it('projects the terminal status through the RPC and returns its TRUE', async () => {
    const fake = fakeClient([{ data: true, error: null }]);

    await expect(
      markConnectPayoutRunStatus(fake.client, terminalInput),
    ).resolves.toBe(true);
    expect(fake.rpcs).toEqual([
      {
        name: 'fn_project_payout_run_terminal',
        args: {
          p_run_id: 'run-1',
          p_payout_id: 'po_1',
          p_target_status: 'failed',
          p_occurred_at: '2026-11-09T12:00:00.000Z',
          p_failure_reason:
            'account_closed | failure_balance_transaction: txn_1',
        },
      },
    ]);
    expect(fake.queries).toHaveLength(0);
  });

  it('uses the target status as the reason when the event has none', async () => {
    const fake = fakeClient([{ data: true, error: null }]);

    await markConnectPayoutRunStatus(fake.client, {
      runId: 'run-1',
      payoutId: 'po_1',
      status: 'paid',
      occurredAt: '2026-11-09T12:00:00.000Z',
    });

    expect(fake.rpcs[0].args).toMatchObject({
      p_target_status: 'paid',
      p_failure_reason: 'paid',
    });
  });

  it.each([false, null])(
    'raises a projection conflict when the RPC returns %p',
    async (data) => {
      const fake = fakeClient([{ data, error: null }]);

      await expect(
        markConnectPayoutRunStatus(fake.client, terminalInput),
      ).rejects.toThrow('PAYOUT_RUN_TERMINAL_PROJECTION_CONFLICT');
    },
  );

  it('propagates an RPC error', async () => {
    const fake = fakeClient([{ data: null, error: { message: 'db down' } }]);

    await expect(
      markConnectPayoutRunStatus(fake.client, terminalInput),
    ).rejects.toThrow('PAYOUT_RUN_UPDATE_FAILED: db down');
  });
});

const evidenceInput = {
  eventId: 'evt_1',
  eventType: 'payout.failed' as const,
  payoutId: 'po_1',
  runId: 'run-1',
  stripeCreatedAt: '2026-11-09T12:00:00.000Z',
  observedStatus: 'failed' as const,
};

describe('appendConnectPayoutEventEvidence', () => {
  it.each([
    [true, 'inserted'],
    [false, 'duplicate'],
  ])('returns %p for an %s event', async (data) => {
    const fake = fakeClient([{ data, error: null }]);

    await expect(
      appendConnectPayoutEventEvidence(fake.client, evidenceInput),
    ).resolves.toBe(data);
    expect(fake.rpcs).toEqual([
      {
        name: 'fn_append_connect_payout_event',
        args: {
          p_stripe_event_id: 'evt_1',
          p_event_type: 'payout.failed',
          p_stripe_payout_id: 'po_1',
          p_connect_payout_run_id: 'run-1',
          p_stripe_created: '2026-11-09T12:00:00.000Z',
          p_observed_payout_status: 'failed',
          p_failure_code: null,
          p_failure_message: null,
          p_failure_balance_transaction: null,
        },
      },
    ]);
  });

  it('passes the failure details of the event', async () => {
    const fake = fakeClient([{ data: true, error: null }]);

    await appendConnectPayoutEventEvidence(fake.client, {
      ...evidenceInput,
      failureCode: 'account_closed',
      failureMessage: 'The bank account is closed',
      failureBalanceTransaction: 'txn_1',
    });

    expect(fake.rpcs[0].args).toMatchObject({
      p_failure_code: 'account_closed',
      p_failure_message: 'The bank account is closed',
      p_failure_balance_transaction: 'txn_1',
    });
  });

  it.each([null, 'true', 1])(
    'rejects a non-boolean RPC result %p',
    async (data) => {
      const fake = fakeClient([{ data, error: null }]);

      await expect(
        appendConnectPayoutEventEvidence(fake.client, evidenceInput),
      ).rejects.toThrow('PAYOUT_EVENT_APPEND_INVALID_RESULT');
    },
  );

  it('propagates an RPC error', async () => {
    const fake = fakeClient([{ data: null, error: { message: 'db down' } }]);

    await expect(
      appendConnectPayoutEventEvidence(fake.client, evidenceInput),
    ).rejects.toThrow('PAYOUT_EVENT_APPEND_FAILED: db down');
  });
});
