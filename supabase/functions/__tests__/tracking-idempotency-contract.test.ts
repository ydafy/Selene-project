import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createEnviaWebhookHandler } from '../envia-webhook/handler.ts';

const root = join(import.meta.dir, '..', '..', '..');
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

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
      resolveSubject: async () => ({ shipmentId: 'shipment-1', disputeId: null }),
      record: async () => {
        records += 1;
      },
      mark: async () => undefined,
      schedule: async (work) => await work(),
    });

    expect((await handler(webhookRequest(webhookPayload('Picked Up')))).status).toBe(200);
    expect((await handler(webhookRequest(webhookPayload('Picked Up')))).status).toBe(200);
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
      resolveSubject: async () => ({ shipmentId: 'shipment-1', disputeId: null }),
      record: async () => {
        records += 1;
      },
      mark: async () => undefined,
      schedule: async (work) => await work(),
    });

    await handler(webhookRequest(webhookPayload('Picked Up')));
    const collision = await handler(webhookRequest(webhookPayload('Delivered')));

    expect(collision.status).toBe(409);
    expect(await collision.json()).toEqual({ error: 'DELIVERY_PAYLOAD_CONFLICT' });
    expect(records).toBe(1);
  });

  it('uses one null-safe event key for webhook and polling collisions before monotonic transitions', () => {
    const migration = read('supabase/migrations/20260828030000_shipment_tracking_foundation.sql');
    const webhook = read('supabase/functions/envia-webhook/index.ts');
    const polling = read('supabase/functions/track-shipments/index.ts');
    const rpc = migration.match(
      /CREATE OR REPLACE FUNCTION public\.fn_record_tracking_event\([\s\S]*?\n\$\$;/,
    )?.[0];

    expect(migration).toContain('shipment_tracking_events_deduplication_key');
    expect(migration).toContain('NULLS NOT DISTINCT');
    expect(webhook).toMatch(/\.rpc\(\s*'fn_record_tracking_event'/);
    expect(polling).toMatch(/\.rpc\(\s*'fn_record_tracking_event'/);
    expect(rpc).toContain('ON CONFLICT DO NOTHING');
    expect(rpc).toContain("IF v_event_id IS NULL THEN\n    RETURN jsonb_build_object('inserted', false");
    expect(rpc).toContain("v_status = 'preparing' AND p_transition = 'shipped'");
    expect(rpc).toContain("v_status = 'shipped' AND p_transition = 'delivered'");
  });
});
