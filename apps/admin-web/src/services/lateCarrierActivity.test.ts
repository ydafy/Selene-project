import { afterAll, beforeEach, expect, it, mock, spyOn } from 'bun:test';

// Keep the supabase mock out of the shared Bun module cache.
if (process.env.B58B_SERVICE_CHILD !== '1') {
  it('checks the late carrier activity service in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B58B_SERVICE_CHILD: '1' },
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
  const { fetchLateCarrierActivity, acknowledgeLateCarrierActivity } = await import('./lateCarrierActivity');
  const { EdgeFunctionError } = await import('./edge-client');

  const row = {
    shipment_id: 'ship-1', order_id: 'order-1', seller_id: 'seller-1', tracking_number: 'TRK1',
    carrier: 'fedex', shipment_status: 'cancelled', source: 'preparing_timeout', refund_status: 'succeeded',
    late_carrier_activity_at: '2026-10-22T10:00:00.000Z', late_carrier_activity_event_type: 'delivered',
  };
  const httpError = (status: number, body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  });

  beforeEach(() => {
    calls.length = 0;
    result = { data: null, error: null };
  });

  it('lists the cases with a GET and no body, mapping the response', async () => {
    result = { data: { late_carrier_activity: [row] }, error: null };
    const cases = await fetchLateCarrierActivity();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ shipmentId: 'ship-1', eventType: 'delivered', shipmentStatus: 'cancelled' });
    expect(calls).toEqual([{ name: 'list-shipment-late-carrier-activity', options: { method: 'GET' } }]);
  });

  it('treats a malformed list response as an error, never partial data', async () => {
    result = { data: { late_carrier_activity: [row, { ...row, late_carrier_activity_event_type: 'other' }] }, error: null };
    await expect(fetchLateCarrierActivity()).rejects.toThrow();
  });

  it('surfaces the stable server code of a failed list call', async () => {
    result = { data: null, error: httpError(403, { error: 'ADMIN_ONLY' }) };
    const error = await fetchLateCarrierActivity().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdgeFunctionError);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBe('ADMIN_ONLY');
  });

  it('posts only the shipment id and the note, and maps the result', async () => {
    result = {
      data: {
        acknowledged_at: '2026-10-22T12:00:00.000Z',
        acknowledged_by: 'admin-1',
        acknowledged_note: 'ok',
        already_acknowledged: false,
      },
      error: null,
    };
    const outcome = await acknowledgeLateCarrierActivity('ship-1', 'ok');
    expect(outcome).toEqual({ acknowledgedAt: '2026-10-22T12:00:00.000Z', note: 'ok', alreadyAcknowledged: false });
    expect(calls).toEqual([{
      name: 'acknowledge-shipment-late-carrier-activity',
      options: { method: 'POST', body: { shipment_id: 'ship-1', note: 'ok' } },
    }]);
  });

  it('rejects a malformed acknowledgement and keeps the code of a failed call', async () => {
    result = { data: { acknowledged_at: 'nope' }, error: null };
    await expect(acknowledgeLateCarrierActivity('ship-1', 'ok')).rejects.toThrow();
    result = { data: null, error: httpError(404, { error: 'LATE_CARRIER_ACTIVITY_NOT_FOUND' }) };
    const error = await acknowledgeLateCarrierActivity('ship-1', 'ok').catch((e: unknown) => e);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBe('LATE_CARRIER_ACTIVITY_NOT_FOUND');
  });

  it('uses a null code when the failure has no readable body', async () => {
    result = { data: null, error: { message: 'network down', context: new Error('fetch failed') } };
    const error = await fetchLateCarrierActivity().catch((e: unknown) => e);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBeNull();
  });
}
