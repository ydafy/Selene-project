import { describe, expect, it } from 'bun:test';

import { createEnviaWebhookHandler } from '../envia-webhook/handler.ts';

const webhookPayload = (status: string) =>
  JSON.stringify({
    type: 'tracking.simple',
    created_at: '2026-08-28T12:30:00.000Z',
    data: { tracking_number: 'TRACK-1', status },
  });

const webhookRequest = (body: string) =>
  new Request('https://example.com/functions/v1/envia-webhook', {
    method: 'POST',
    headers: {
      'X-Webhook-Event': 'tracking.simple',
      'X-Webhook-Id': 'delivery-1',
    },
    body,
  });

describe('tracking ingestion idempotency contract', () => {
  it('replays the same delivery without scheduling a second event record', async () => {
    let records = 0;
    const handler = createEnviaWebhookHandler({
      verify: async () => true,
      claim: async () =>
        records === 0
          ? { kind: 'new', id: 'db-delivery-1' }
          : { kind: 'duplicate' },
      resolveSubject: async () => ({
        shipmentId: 'shipment-1',
        disputeId: null,
      }),
      record: async () => {
        records += 1;
      },
      mark: async () => undefined,
      schedule: async (work) => await work(),
    });

    expect(
      (await handler(webhookRequest(webhookPayload('Picked Up')))).status,
    ).toBe(200);
    expect(
      (await handler(webhookRequest(webhookPayload('Picked Up')))).status,
    ).toBe(200);
    expect(records).toBe(1);
  });

  it('fails closed when a replayed delivery ID has a different payload', async () => {
    let records = 0;
    let firstPayload: string | undefined;
    const handler = createEnviaWebhookHandler({
      verify: async () => true,
      claim: async ({ rawBody }) => {
        if (!firstPayload) {
          firstPayload = rawBody;
          return { kind: 'new', id: 'db-delivery-1' };
        }
        if (rawBody !== firstPayload) return { kind: 'collision' };
        return { kind: 'duplicate' };
      },
      resolveSubject: async () => ({
        shipmentId: 'shipment-1',
        disputeId: null,
      }),
      record: async () => {
        records += 1;
      },
      mark: async () => undefined,
      schedule: async (work) => await work(),
    });

    await handler(webhookRequest(webhookPayload('Picked Up')));
    const collision = await handler(
      webhookRequest(webhookPayload('Delivered')),
    );

    expect(collision.status).toBe(409);
    expect(await collision.json()).toEqual({
      error: 'DELIVERY_PAYLOAD_CONFLICT',
    });
    expect(records).toBe(1);
  });
});
