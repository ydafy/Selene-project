import { afterAll, beforeEach, expect, it, mock, spyOn } from 'bun:test';

// Keep the supabase mock out of the shared Bun module cache.
if (process.env.B24_SERVICE_CHILD !== '1') {
  it('checks the shipment refund service in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B24_SERVICE_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  const offlineFetch: typeof fetch = Object.assign(() => {
    throw new Error('Unexpected external request');
  }, {
    preconnect: () => { throw new Error('Unexpected external preconnect'); },
  });
  const denyFetch = spyOn(globalThis, 'fetch').mockImplementation(offlineFetch);
  afterAll(() => denyFetch.mockRestore());

  const calls: Array<{ name: string; options: Record<string, unknown> }> = [];
  let result: { data: unknown; error: unknown };
  mock.module('../lib/supabase', () => ({
    supabase: {
      functions: {
        invoke: async (name: string, options: Record<string, unknown>) => {
          calls.push({ name, options });
          return result;
        },
      },
    },
  }));
  const { fetchShipmentRefundProblems, resolveShipmentRefund } = await import('./shipmentRefunds');
  const { EdgeFunctionError } = await import('./edge-client');

  const problem = {
    shipmentId: 'ship-1', orderId: 'order-1', buyerId: 'buyer-1', shipmentStatus: 'paid',
    kind: 'refund_failed', refundId: 're_1', refundFailureReason: null, amountOwedCents: 5000,
    paymentIntentId: 'pi_1', since: '2026-10-22T10:00:00.000Z',
  };
  const httpError = (status: number, body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  });

  beforeEach(() => {
    calls.length = 0;
    result = { data: null, error: null };
  });

  it('lists problems with a GET and no body, validating the response', async () => {
    result = { data: { problems: [problem] }, error: null };
    expect(await fetchShipmentRefundProblems()).toEqual([problem]);
    expect(calls).toEqual([{ name: 'list-shipment-refund-problems', options: { method: 'GET' } }]);
  });

  it('treats a malformed list response as an error, never partial data', async () => {
    result = { data: { problems: [problem, { ...problem, amountOwedCents: 1.5 }] }, error: null };
    await expect(fetchShipmentRefundProblems()).rejects.toThrow();
  });

  it('surfaces the stable server code of a failed list call', async () => {
    result = { data: null, error: httpError(403, { error: 'ADMIN_ONLY' }) };
    const error = await fetchShipmentRefundProblems().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdgeFunctionError);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBe('ADMIN_ONLY');
  });

  it('posts the exact resolve body and maps the result', async () => {
    result = { data: { resolved: true, shipment_cancelled: false, amount_owed_cents: 5000, reference: 'SPEI-1' }, error: null };
    const outcome = await resolveShipmentRefund('ship-1', 'SPEI-1');
    expect(outcome).toEqual({ resolved: true, shipmentCancelled: false, amountOwedCents: 5000, reference: 'SPEI-1' });
    expect(calls).toEqual([{
      name: 'resolve-shipment-refund',
      options: { method: 'POST', body: { shipment_id: 'ship-1', reference: 'SPEI-1' } },
    }]);
  });

  it('rejects a malformed resolve result and keeps the code of a failed call', async () => {
    result = { data: { resolved: 'yes' }, error: null };
    await expect(resolveShipmentRefund('ship-1', 'SPEI-1')).rejects.toThrow();
    result = { data: null, error: httpError(409, { error: 'REFUND_NOT_RESOLVABLE' }) };
    const error = await resolveShipmentRefund('ship-1', 'SPEI-1').catch((e: unknown) => e);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBe('REFUND_NOT_RESOLVABLE');
  });

  it('uses a null code when the failure has no readable body', async () => {
    result = { data: null, error: { message: 'network down', context: new Error('fetch failed') } };
    const error = await fetchShipmentRefundProblems().catch((e: unknown) => e);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBeNull();
  });
}
