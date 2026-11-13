// source-text: envia-webhook/index.ts builds its database adapters inline at module load and track-shipments/index.ts reads its deploy-time secret names there; neither has a seam a test can call
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createEnviaWebhookHandler } from '../envia-webhook/handler.ts';

const read = (relativePath: string) =>
  readFileSync(
    join(import.meta.dir, '..', '..', '..', relativePath),
    'utf8',
  ).replace(/\s+/g, ' ');

const webhookRequest = (headers: Record<string, string>) =>
  new Request('https://example.com/functions/v1/envia-webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'tracking.simple',
      created_at: '2026-08-28T12:30:00.000Z',
      data: { tracking_number: 'TRACK-1', status: 'Picked Up' },
    }),
  });

describe('tracking ingestion source guards', () => {
  it.each([
    [
      'an event other than tracking.simple',
      { 'X-Webhook-Event': 'tracking.complete', 'X-Webhook-Id': 'delivery-1' },
    ],
    ['a delivery without an id', { 'X-Webhook-Event': 'tracking.simple' }],
  ])(
    'rejects %s with 400 before claiming or recording it',
    async (_case, headers) => {
      const calls: string[] = [];
      const handler = createEnviaWebhookHandler({
        verify: async () => true,
        claim: async () => {
          calls.push('claim');
          return { kind: 'new', id: 'db-delivery-1' };
        },
        resolveSubject: async () => {
          calls.push('resolve');
          return { shipmentId: 'shipment-1', disputeId: null };
        },
        record: async () => {
          calls.push('record');
        },
        mark: async () => {
          calls.push('mark');
        },
        schedule: async (work) => await work(),
      });

      const response = await handler(webhookRequest(headers));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'INVALID_WEBHOOK_EVENT',
      });
      expect(calls).toEqual([]);
    },
  );

  it('claims webhook deliveries and records their events only through fn_record_tracking_event', () => {
    const webhook = read('supabase/functions/envia-webhook/index.ts');

    expect(webhook).toContain('verifyEnviaWebhook');
    // webhook_deliveries lives in the internal schema: only its RPCs reach it.
    expect(webhook).toContain('createWebhookDeliveryPorts(supabaseAdmin)');
    expect(webhook).not.toContain('webhook_deliveries');
    expect(webhook).toMatch(/\.rpc\(\s*'fn_record_tracking_event'/);
    expect(webhook).not.toContain(".from('shipment_tracking_events')");
  });

  it('reads the track-shipments cron secret and polling switch from their deployed secret names', () => {
    const entrypoint = read('supabase/functions/track-shipments/index.ts');

    expect(entrypoint).toContain(
      "secret: Deno.env.get('TRACK_SHIPMENTS_CRON_SECRET')",
    );
    expect(entrypoint).toContain(
      "pollingEnabled: Deno.env.get('TRACK_SHIPMENTS_POLLING_ENABLED')",
    );
  });
});
