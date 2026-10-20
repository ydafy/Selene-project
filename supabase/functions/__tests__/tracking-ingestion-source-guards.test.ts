import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(
    join(import.meta.dir, '..', '..', '..', relativePath),
    'utf8',
  ).replace(/\s+/g, ' ');

describe('tracking ingestion source guards', () => {
  it('accepts only signed tracking.simple deliveries and gives duplicate deliveries their exact acknowledgement', () => {
    const webhook = read('supabase/functions/envia-webhook/index.ts');
    const handler = read('supabase/functions/envia-webhook/handler.ts');
    const config = read('supabase/config.toml');

    expect(config).toContain('[functions.envia-webhook] verify_jwt = false');
    expect(webhook).toContain('verifyEnviaWebhook');
    expect(handler).toContain("eventName !== 'tracking.simple'");
    expect(handler).toContain('webhookReceipt(true)');
    expect(handler).toContain('webhookReceipt(false)');
    expect(webhook).toContain(".from('webhook_deliveries')");
    expect(webhook).toContain(".rpc('fn_record_tracking_event'");
  });

  it('keeps shipment polling lane-filtered, bounded, lease-protected, and RPC-only without direct status updates', () => {
    const shipments = read('supabase/functions/track-shipments/index.ts');
    const shipmentHandler = read(
      'supabase/functions/track-shipments/handler.ts',
    );
    const returns = read('supabase/functions/track-returns/index.ts');
    const config = read('supabase/config.toml');

    for (const source of [shipmentHandler, returns]) {
      expect(source).toContain('buildPollingTrackingEvents');
    }
    for (const source of [shipments, returns]) {
      expect(source).toContain('fn_record_tracking_event');
      expect(source).toContain('p_polling_run_id');
    }
    expect(config).toContain('[functions.track-shipments] verify_jwt = false');
    expect(shipments).toContain(".eq('status', status)");
    expect(shipments).toContain(
      ".order('last_tracked_at', { ascending: true, nullsFirst: true })",
    );
    expect(shipments).toContain('.limit(BATCH_SIZE)');
    expect(shipments).toContain('const BATCH_SIZE = 50');
    expect(shipments).toContain('const TRACKING_DEADLINE_MS = 90_000');
    expect(shipmentHandler).toContain("req.headers.get('Authorization')");
    expect(shipments).toContain('TRACK_SHIPMENTS_CRON_SECRET');
    expect(shipments).toContain('TRACK_SHIPMENTS_POLLING_ENABLED');
    expect(shipments).toContain('isInvalidPollingResponse');
    expect(shipments).toContain('ENVIA_TRACKING_INVALID_RESPONSE');
    expect(shipments).toContain("!Object.hasOwn(observation, 'status')");
    expect(
      shipments.indexOf('data.some(isInvalidPollingResponse)'),
    ).toBeLessThan(
      shipments.indexOf('return data.flatMap(extractEnviaPollingObservations)'),
    );
    expect(shipmentHandler).toContain("reason: 'busy'");
    expect(shipmentHandler).toContain('releaseLease');
    expect(shipments).toContain("'fn_acquire_track_shipments_lease'");
    expect(shipments).toContain("'fn_release_track_shipments_lease'");
    expect(shipmentHandler).not.toContain('x-tracking-cron-secret');
    expect(shipments).toContain('last_tracked_at');
    expect(returns).toContain('return_last_tracked_at');
    expect(returns).toContain('p_dispute_id: dispute.id');
    expect(shipments).not.toContain(".update({ status: 'shipped'");
    expect(shipments).not.toContain('fn_mark_shipment_delivered');
    expect(returns).not.toContain('fn_mark_return_delivered');
  });

  it('keeps every tracking ingestion path on the privileged event RPC boundary', () => {
    const ingestionSources = [
      read('supabase/functions/envia-webhook/index.ts'),
      read('supabase/functions/track-shipments/index.ts'),
      read('supabase/functions/track-returns/index.ts'),
    ];

    for (const source of ingestionSources) {
      expect(source).toMatch(/\.rpc\(\s*'fn_record_tracking_event'/);
      expect(source).not.toContain(".from('shipment_tracking_events')");
    }
  });
});
