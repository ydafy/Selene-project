import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = join(import.meta.dir, '..');
const read = (relativePath: string) =>
  readFileSync(join(CORE, relativePath), 'utf8').replace(/\s+/g, ' ');

describe('shipment tracking frontend boundaries', () => {
  it('reads shipment events through the authenticated RLS client in carrier-time order', () => {
    const hook = read('hooks/useShipmentTracking.ts');

    expect(hook).toContain("from('shipment_tracking_events')");
    expect(hook).toContain(".eq('shipment_id', shipmentId)");
    expect(hook).toContain(".order('event_at', { ascending: true })");
    expect(hook).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('keeps Envia mode server-side and integrates the URL and timeline into order detail', () => {
    const hook = read('hooks/useShipmentTracking.ts');
    const detail = read('..\\app\\profile\\orders\\[id].tsx');
    const timeline = read('..\\components\\features\\orders\\ShipmentTrackingTimeline.tsx');
    const english = read('i18n/locales/en/orders.json');
    const spanish = read('i18n/locales/es/orders.json');

    expect(hook).toContain("invokeEdge('resolve-shipment-tracking-url', { shipmentId })");
    expect(hook).not.toContain('ENVIA_MODE');
    expect(detail).toContain('useShipmentTrackingEvents(currentShipment?.id)');
    expect(detail).toContain('useShipmentTrackingUrl(currentShipment?.id)');
    expect(timeline).toContain('getTrackingEventLabelKey(event.event_type)');
    expect(english).toContain('"title": "Tracking updates"');
    expect(spanish).toContain('"title": "Actualizaciones de rastreo"');
    expect(english).toContain('"events"');
    expect(spanish).toContain('"events"');
  });
});
