import { afterAll, beforeEach, expect, it, mock, spyOn } from 'bun:test';

// Keep the supabase mock out of the shared Bun module cache.
if (process.env.OVERDUE_API_CHILD !== '1') {
  it('checks the overdue payout service in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { OVERDUE_API_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  const offlineFetch: typeof fetch = Object.assign(
    () => {
      throw new Error('Unexpected external request');
    },
    {
      preconnect: () => {
        throw new Error('Unexpected external preconnect');
      },
    },
  );
  const denyFetch = spyOn(globalThis, 'fetch').mockImplementation(offlineFetch);
  afterAll(() => denyFetch.mockRestore());

  const calls: Array<{ name: string; options: Record<string, unknown> }> = [];
  let result: { data: unknown; error: unknown };
  mock.module('@/shared/lib/supabase', () => ({
    supabase: {
      functions: {
        invoke: async (name: string, options: Record<string, unknown>) => {
          calls.push({ name, options });
          return result;
        },
      },
    },
  }));
  const { recordPayoutHoldNote, refundOverduePayout } =
    await import('./overdue-payouts-api');
  const { EdgeFunctionError } = await import('@/shared/lib/edge-client');

  const shipmentId = '7b310000-0000-4000-8000-000000000011';
  const httpError = (status: number, body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  });
  const codeOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdgeFunctionError);
    return (error as InstanceType<typeof EdgeFunctionError>).code;
  };

  beforeEach(() => {
    calls.length = 0;
    result = { data: null, error: null };
  });

  it('posts only the shipment and the note, and maps the stored note', async () => {
    result = {
      data: {
        id: '9c000000-0000-4000-8000-000000000001',
        shipment_id: shipmentId,
        note: 'Stripe sigue revisando la cuenta.',
        noted_at: '2026-11-14T05:27:34.123456+00:00',
        noted_by: '00000000-0000-4000-8000-000000000001',
      },
      error: null,
    };
    expect(
      await recordPayoutHoldNote(
        shipmentId,
        'Stripe sigue revisando la cuenta.',
      ),
    ).toEqual({
      id: '9c000000-0000-4000-8000-000000000001',
      shipmentId,
      note: 'Stripe sigue revisando la cuenta.',
      notedAt: '2026-11-14T05:27:34.123456+00:00',
      notedBy: '00000000-0000-4000-8000-000000000001',
    });
    expect(calls).toEqual([
      {
        name: 'record-payout-hold-note',
        options: {
          method: 'POST',
          body: {
            shipment_id: shipmentId,
            note: 'Stripe sigue revisando la cuenta.',
          },
        },
      },
    ]);
  });

  it('keeps the stable code of a refused hold note', async () => {
    result = {
      data: null,
      error: httpError(409, { error: 'PAYOUT_NOT_OVERDUE' }),
    };
    expect(await codeOf(recordPayoutHoldNote(shipmentId, 'x'))).toBe(
      'PAYOUT_NOT_OVERDUE',
    );
  });

  it('posts only the shipment id for a refund: the server computes the amount', async () => {
    result = {
      data: {
        status: 'refunded',
        shipment_id: shipmentId,
        refund_id: 're_3Q',
        amount_cents: 10600,
      },
      error: null,
    };
    expect(await refundOverduePayout(shipmentId)).toEqual({
      status: 'refunded',
      shipmentId,
      refundId: 're_3Q',
      amountCents: 10600,
    });
    expect(calls).toEqual([
      {
        name: 'refund-overdue-payout',
        options: { method: 'POST', body: { shipment_id: shipmentId } },
      },
    ]);
  });

  it('reads a 202 pending refund as pending, not refunded', async () => {
    result = {
      data: {
        status: 'pending',
        shipment_id: shipmentId,
        refund_id: 're_pending',
        amount_cents: 10600,
      },
      error: null,
    };
    expect((await refundOverduePayout(shipmentId)).status).toBe('pending');
  });

  it('keeps the stable code of a refused or failed refund and rejects a malformed answer', async () => {
    result = { data: null, error: httpError(409, { error: 'REFUND_FAILED' }) };
    expect(await codeOf(refundOverduePayout(shipmentId))).toBe('REFUND_FAILED');
    result = {
      data: null,
      error: httpError(500, { error: 'INTERNAL_ERROR' }),
    };
    expect(await codeOf(refundOverduePayout(shipmentId))).toBe(
      'INTERNAL_ERROR',
    );
    result = { data: { status: 'refunded' }, error: null };
    await expect(refundOverduePayout(shipmentId)).rejects.toThrow();
  });
}
