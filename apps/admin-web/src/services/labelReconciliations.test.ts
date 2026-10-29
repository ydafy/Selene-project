import { afterAll, beforeEach, expect, it, mock, spyOn } from 'bun:test';

// Keep the supabase mock out of the shared Bun module cache.
if (process.env.B61C_SERVICE_CHILD !== '1') {
  it('checks the label reconciliations service in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { B61C_SERVICE_CHILD: '1' },
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
  const { fetchLabelReconciliations, resolveLabelReconciliation } = await import('./labelReconciliations');
  const { EdgeFunctionError } = await import('./edge-client');

  const row = {
    shipment_id: 'ship-1', order_id: 'order-1', seller_id: 'seller-1', seller_name: 'vendedor',
    buyer_id: 'buyer-1', buyer_name: 'comprador', shipment_created_at: '2026-10-20T10:00:00.000Z',
    label_generation_state: 'orphan_pending', stuck_at: '2026-10-21T10:00:00.000Z', claim_expires_at: null,
    last_label_event_at: null, quote_carrier: 'paquetexpress', quote_service: 'ground', quote_cost_cents: 15000,
    quote_rated_at: null, origin_postal_code: '64000', origin_city: 'Monterrey',
    destination_postal_code: '06600', destination_city: 'CDMX',
  };
  const resolved = {
    result: 'resolved', resolution: 'no_label', shipment_id: 'ship-1', status: 'paid', label_generation_state: 'unclaimed',
  };
  const httpError = (status: number, body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  });

  beforeEach(() => {
    calls.length = 0;
    result = { data: null, error: null };
  });

  it('lists the stuck shipments with a GET and no body, mapping the response', async () => {
    result = { data: { label_reconciliations: [row] }, error: null };
    const cases = await fetchLabelReconciliations();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ shipmentId: 'ship-1', state: 'orphan_pending', quoteCostCents: 15000 });
    expect(calls).toEqual([{ name: 'list-shipment-label-reconciliations', options: { method: 'GET' } }]);
  });

  it('treats a malformed list response as an error, never partial data', async () => {
    result = { data: { label_reconciliations: [row, { ...row, label_generation_state: 'other' }] }, error: null };
    await expect(fetchLabelReconciliations()).rejects.toThrow();
  });

  it('surfaces the stable server code of a failed list call', async () => {
    result = { data: null, error: httpError(403, { error: 'ADMIN_ONLY' }) };
    const error = await fetchLabelReconciliations().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdgeFunctionError);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBe('ADMIN_ONLY');
  });

  it('posts only the shipment, the resolution and the note for no_label', async () => {
    result = { data: resolved, error: null };
    const outcome = await resolveLabelReconciliation({ shipmentId: 'ship-1', resolution: 'no_label', note: 'No hay guía' });
    expect(outcome).toEqual({ resolution: 'no_label', status: 'paid', labelGenerationState: 'unclaimed' });
    expect(calls).toEqual([{
      name: 'resolve-shipment-label-reconciliation',
      options: { method: 'POST', body: { shipment_id: 'ship-1', resolution: 'no_label', note: 'No hay guía' } },
    }]);
  });

  it('posts the label data with the cost in integer cents for label_found', async () => {
    result = { data: { ...resolved, resolution: 'label_found', status: 'preparing', label_generation_state: 'generated' }, error: null };
    await resolveLabelReconciliation({
      shipmentId: 'ship-1',
      resolution: 'label_found',
      note: 'Está en Envía',
      enviaShipmentId: '98765',
      trackingNumber: 'PX123',
      labelUrl: 'https://labels.example/px123.pdf',
      providerCostCents: 9350,
    });
    expect(calls).toEqual([{
      name: 'resolve-shipment-label-reconciliation',
      options: {
        method: 'POST',
        body: {
          shipment_id: 'ship-1',
          resolution: 'label_found',
          note: 'Está en Envía',
          envia_shipment_id: '98765',
          tracking_number: 'PX123',
          label_url: 'https://labels.example/px123.pdf',
          provider_cost_cents: 9350,
        },
      },
    }]);
  });

  it('rejects a malformed result and keeps the code of a failed call', async () => {
    result = { data: { result: 'resolved' }, error: null };
    await expect(resolveLabelReconciliation({ shipmentId: 'ship-1', resolution: 'no_label', note: 'x' })).rejects.toThrow();
    result = { data: null, error: httpError(409, { error: 'ALREADY_RESOLVED' }) };
    const error = await resolveLabelReconciliation({ shipmentId: 'ship-1', resolution: 'no_label', note: 'x' }).catch((e: unknown) => e);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBe('ALREADY_RESOLVED');
  });

  it('uses a null code when the failure has no readable body', async () => {
    result = { data: null, error: { message: 'network down', context: new Error('fetch failed') } };
    const error = await fetchLabelReconciliations().catch((e: unknown) => e);
    expect((error as InstanceType<typeof EdgeFunctionError>).code).toBeNull();
  });
}
