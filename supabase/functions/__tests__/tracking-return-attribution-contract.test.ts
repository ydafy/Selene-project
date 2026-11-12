import { describe, expect, it } from 'bun:test';

import { createEnviaWebhookHandler } from '../envia-webhook/handler.ts';

const returnWebhookPayload = JSON.stringify({
  type: 'tracking.simple',
  created_at: '2026-08-30T12:30:00.000Z',
  data: { tracking_number: 'RETURN-TRACK-1', status: 'Delivered' },
});

const returnWebhookRequest = () =>
  new Request('https://example.com/functions/v1/envia-webhook', {
    method: 'POST',
    headers: {
      'X-Webhook-Event': 'tracking.simple',
      'X-Webhook-Id': 'return-delivery-1',
    },
    body: returnWebhookPayload,
  });

describe('tracking return attribution contract', () => {
  it('passes a uniquely resolved return webhook event to its dispute', async () => {
    const recorded: unknown[] = [];
    const handler = createEnviaWebhookHandler({
      verify: async () => true,
      claim: async () => ({ kind: 'new', id: 'return-delivery-1' }),
      resolveSubject: async () => ({
        shipmentId: 'outbound-shipment-1',
        disputeId: 'return-dispute-1',
      }),
      record: async (input) => {
        recorded.push(input);
      },
      mark: async () => undefined,
      schedule: async (work) => await work(),
    });

    const response = await handler(returnWebhookRequest());

    expect(response.status).toBe(200);
    expect(recorded).toEqual([
      expect.objectContaining({
        shipmentId: 'outbound-shipment-1',
        disputeId: 'return-dispute-1',
        event: expect.objectContaining({
          trackingNumber: 'RETURN-TRACK-1',
          transition: 'delivered',
        }),
      }),
    ]);
  });
});
