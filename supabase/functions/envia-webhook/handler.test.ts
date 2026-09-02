import { describe, expect, it } from 'bun:test';

import { createEnviaWebhookHandler } from './handler.ts';

const payload = JSON.stringify({
  type: 'tracking.simple',
  created_at: '2026-08-28T12:30:00.000Z',
  data: { tracking_number: 'TRACK-1', status: 'Picked Up' },
});

const requestFor = () =>
  new Request('https://example.com/functions/v1/envia-webhook', {
    method: 'POST',
    headers: {
      'X-Webhook-Event': 'tracking.simple',
      'X-Webhook-Id': 'delivery-1',
    },
    body: payload,
  });

const dependencies = () => ({
  verify: async () => true,
  claim: async () => ({ kind: 'new' as const, id: 'db-delivery-1' }),
  resolveSubject: async () => ({ shipmentId: 'shipment-1', disputeId: null }),
  record: async () => undefined,
  mark: async () => undefined,
  schedule: async (work: () => Promise<void>) => await work(),
});

describe('envia webhook handler', () => {
  it('accepts a GET connection check without verifying, claiming, or recording', async () => {
    let invoked = false;
    const handler = createEnviaWebhookHandler({
      ...dependencies(),
      verify: async () => {
        invoked = true;
        return true;
      },
      claim: async () => {
        invoked = true;
        return { kind: 'new', id: 'db-delivery-1' };
      },
      record: async () => {
        invoked = true;
      },
    });

    const response = await handler(
      new Request('https://example.com/functions/v1/envia-webhook'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(invoked).toBe(false);
  });

  it('rejects an invalid signature before it claims or records a delivery', async () => {
    let claimed = false;
    const handler = createEnviaWebhookHandler({
      ...dependencies(),
      verify: async () => false,
      claim: async () => {
        claimed = true;
        return { kind: 'new', id: 'db-delivery-1' };
      },
    });

    const response = await handler(requestFor());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'INVALID_SIGNATURE' });
    expect(claimed).toBe(false);
  });

  it('returns the exact duplicate acknowledgement without scheduling a record', async () => {
    let scheduled = false;
    const handler = createEnviaWebhookHandler({
      ...dependencies(),
      claim: async () => ({ kind: 'duplicate' }),
      schedule: async () => {
        scheduled = true;
      },
    });

    const response = await handler(requestFor());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      deduplicated: true,
    });
    expect(scheduled).toBe(false);
  });

  it('acknowledges and records a valid signed delivery for its resolved shipment', async () => {
    const recorded: Array<{
      shipmentId: string;
      disputeId: string | null;
      deliveryId: string;
    }> = [];
    const handler = createEnviaWebhookHandler({
      ...dependencies(),
      record: async (input) => recorded.push(input),
    });

    const response = await handler(requestFor());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      deduplicated: false,
    });
    expect(recorded).toEqual([
      {
        shipmentId: 'shipment-1',
        disputeId: null,
        deliveryId: 'db-delivery-1',
        event: {
          trackingNumber: 'TRACK-1',
          rawStatus: 'Picked Up',
          eventType: 'in_transit',
          transition: 'shipped',
          eventAt: '2026-08-28T12:30:00.000Z',
          statusDescription: null,
          location: null,
          carrierName: null,
        },
      },
    ]);
  });
});
