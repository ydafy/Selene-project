import { afterAll, beforeEach, expect, it, mock, spyOn } from 'bun:test';

// Keep the supabase mock out of the shared Bun module cache.
if (process.env.B44D_SERVICE_CHILD !== '1') {
  it('checks the carrier reviews service in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B44D_SERVICE_CHILD: '1' },
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
  const { fetchCarrierReviews, resolveCarrierReview } = await import('./carrierReviews');
  const { EdgeFunctionError } = await import('./edge-client');

  const review = {
    shipment_id: 'ship-1', order_id: 'order-1', seller_id: 'seller-1', tracking_number: 'TRK1',
    carrier: 'fedex', label_provider_cost_cents: 15000, review_reason: 'carrier_refused',
    carrier_cancellation_outcome: 'refused', review_required_at: '2026-10-22T10:00:00.000Z',
  };
  const httpError = (status: number, body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  });

  beforeEach(() => {
    calls.length = 0;
    result = { data: null, error: null };
  });

  it('lists reviews with a GET and no body, mapping the response', async () => {
    result = { data: { reviews: [review] }, error: null };
    const reviews = await fetchCarrierReviews();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ shipmentId: 'ship-1', labelCostCents: 15000, reason: 'carrier_refused' });
    expect(calls).toEqual([{ name: 'list-shipment-operation-reviews', options: { method: 'GET' } }]);
  });

  it('treats a malformed list response as an error, never partial data', async () => {
    result = { data: { reviews: [review, { ...review, label_provider_cost_cents: 1.5 }] }, error: null };
    await expect(fetchCarrierReviews()).rejects.toThrow();
  });

  it('surfaces the stable server code of a failed list call', async () => {
    result = { data: null, error: httpError(403, { error: 'ADMIN_ONLY' }) };
    const error = await fetchCarrierReviews().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdgeFunctionError);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBe('ADMIN_ONLY');
  });

  it('posts the exact resolve body and maps the result', async () => {
    result = {
      data: {
        review_resolution: 'refund_approved',
        review_resolved_at: '2026-10-22T12:00:00.000Z',
        review_resolved_by: 'admin-1',
        review_resolution_note: 'ok',
        label_cost_loss_cents: 15000,
      },
      error: null,
    };
    const outcome = await resolveCarrierReview('ship-1', 'refund_approved', 'ok');
    expect(outcome).toEqual({
      resolution: 'refund_approved',
      resolvedAt: '2026-10-22T12:00:00.000Z',
      note: 'ok',
      labelCostLossCents: 15000,
    });
    expect(calls).toEqual([{
      name: 'resolve-shipment-operation-review',
      options: { method: 'POST', body: { shipment_id: 'ship-1', resolution: 'refund_approved', note: 'ok' } },
    }]);
  });

  it('rejects a malformed resolve result and keeps the code of a failed call', async () => {
    result = { data: { review_resolution: 'yes' }, error: null };
    await expect(resolveCarrierReview('ship-1', 'closed_no_refund', 'ok')).rejects.toThrow();
    result = { data: null, error: httpError(409, { error: 'CARRIER_REVIEW_NOT_PENDING' }) };
    const error = await resolveCarrierReview('ship-1', 'closed_no_refund', 'ok').catch((e: unknown) => e);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBe('CARRIER_REVIEW_NOT_PENDING');
  });

  it('uses a null code when the failure has no readable body', async () => {
    result = { data: null, error: { message: 'network down', context: new Error('fetch failed') } };
    const error = await fetchCarrierReviews().catch((e: unknown) => e);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBeNull();
  });
}
