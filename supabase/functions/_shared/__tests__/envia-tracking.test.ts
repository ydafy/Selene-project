import { describe, expect, it } from 'bun:test';
import { normalizeEnviaTrackingStatus, resolveEnviaTrackingUrl } from '../envia-tracking.ts';

const statusCases = [
  ['Created', 'created', null], ['Shipped', 'in_transit', 'shipped'], ['Delivered', 'delivered', 'delivered'], ['Canceled', 'information', null], ['Information', 'information', null], ['N/A', 'information', null], ['Pending', 'information', null], ['Picked Up', 'in_transit', 'shipped'], ['Out for Delivery', 'in_transit', 'shipped'], ['Lost', 'exception', null], ['Returned', 'returned', null], ['Pickup at Office', 'information', null], ['Delivered at Origin', 'returned', null], ['Damaged', 'exception', null], ['Redirected', 'information', null], ['Out for Pickup', 'in_transit', 'shipped'], ['1 delivery attempt', 'exception', null], ['2 delivery attempts', 'exception', null], ['3 delivery attempts', 'exception', null], ['Return problem', 'exception', null], ['Address error', 'exception', null], ['Undeliverable', 'exception', null], ['Delayed', 'exception', null], ['Rejected', 'exception', null], ['1 pickup attempt', 'information', null], ['Partially Shipped', 'information', null], ['Partially Delivered', 'information', null], ['Delivery Attempt', 'exception', null],
] as const;

describe('normalizeEnviaTrackingStatus', () => {
  it('maps every Envia catalog status to a canonical event and permitted shipment transition', () => {
    for (const [status, eventType, shipmentTransition] of statusCases) expect(normalizeEnviaTrackingStatus(status)).toEqual({ eventType, shipmentTransition });
  });
  it('normalizes casing and whitespace while failing unknown provider statuses closed to a ledger-only event', () => {
    expect(normalizeEnviaTrackingStatus('  out FOR delivery  ')).toEqual({ eventType: 'in_transit', shipmentTransition: 'shipped' });
    expect(normalizeEnviaTrackingStatus('Carrier-specific status')).toEqual({ eventType: 'information', shipmentTransition: null });
  });
});

describe('resolveEnviaTrackingUrl', () => {
  it('uses the production rastreo endpoint and URL-encodes labels', () => expect(resolveEnviaTrackingUrl('production', 'ABC 123/4')).toBe('https://envia.com/rastreo?label=ABC%20123%2F4&cntry_code=mx'));
  it('uses the sandbox rastreo endpoint and rejects unsupported runtime modes', () => {
    expect(resolveEnviaTrackingUrl('sandbox', 'TRACK-1')).toBe('https://test.envia.com/rastreo?label=TRACK-1&cntry_code=mx');
    expect(resolveEnviaTrackingUrl('staging', 'TRACK-1')).toBeNull();
  });
});
