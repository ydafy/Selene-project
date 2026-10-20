import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createEnviaWebhookHandler } from '../envia-webhook/handler.ts';

const root = join(import.meta.dir, '..', '..', '..');
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

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
    expect(recorded).toEqual([expect.objectContaining({
      shipmentId: 'outbound-shipment-1',
      disputeId: 'return-dispute-1',
      event: expect.objectContaining({
        trackingNumber: 'RETURN-TRACK-1',
        transition: 'delivered',
      }),
    })]);
  });

  it('persists polling return events with the matched dispute ID', () => {
    const returnsPolling = read('supabase/functions/track-returns/index.ts');

    expect(returnsPolling).toContain(".from('disputes')");
    expect(returnsPolling).toContain(".select('id, shipment_id, return_tracking_number')");
    expect(returnsPolling).toContain('p_shipment_id: dispute.shipmentId');
    expect(returnsPolling).toContain('p_dispute_id: dispute.id');
  });

  it('keeps return webhook and polling events ledger-only for the outbound shipment', () => {
    const migration = read('supabase/migrations/20260828030000_shipment_tracking_foundation.sql');
    const rpc = migration
      .match(
        /CREATE OR REPLACE FUNCTION public\.fn_record_tracking_event\([\s\S]*?\n\$\$;/,
      )?.[0]
      ?.replace(/\s+/g, ' ');

    expect(rpc).toContain('shipment_id, dispute_id, event_type');
    expect(rpc).toContain('p_shipment_id, p_dispute_id, p_event_type');
    expect(rpc).toContain("IF p_dispute_id IS NULL AND v_status = 'preparing' AND p_transition = 'shipped' THEN");
    expect(rpc).toContain("ELSIF p_dispute_id IS NULL AND v_status = 'shipped' AND p_transition = 'delivered' THEN");
  });
});
