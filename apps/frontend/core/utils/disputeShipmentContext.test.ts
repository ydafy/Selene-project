import { describe, expect, it } from 'bun:test';

import {
  buildOpenDisputeRequest,
  getOpenDisputeInvalidationKeys,
  resolveShipmentContext,
} from './disputeShipmentContext';

describe('dispute shipment context helpers', () => {
  it('resolves a shipment id from Expo search params', () => {
    expect(resolveShipmentContext('ship-1')).toEqual({ shipmentId: 'ship-1' });
  });

  it('rejects missing shipment context before dispute creation', () => {
    expect(resolveShipmentContext(undefined)).toEqual({
      error: 'Missing shipment context. Please start the report from a shipment.',
    });
  });

  it('rejects ambiguous multi-value shipment params before dispute creation', () => {
    expect(resolveShipmentContext(['ship-1', 'ship-2'])).toEqual({
      error: 'Missing shipment context. Please start the report from a shipment.',
    });
  });

  it('builds create-dispute payloads with order and shipment scope', () => {
    expect(
      buildOpenDisputeRequest('order-1', {
        shipmentId: 'ship-1',
        reason: 'damaged',
        description: 'GPU arrived damaged.',
        images: ['image-1'],
        checklist: { physical_damage: true },
        videoUrl: 'video-1',
      }),
    ).toEqual({
      orderId: 'order-1',
      shipmentId: 'ship-1',
      reason: 'damaged',
      description: 'GPU arrived damaged.',
      evidence: {
        images: ['image-1'],
        tech_checklist: { physical_damage: true },
        video_url: 'video-1',
      },
    });
  });

  it('includes order, shipment, purchase, and dispute query invalidations', () => {
    expect(getOpenDisputeInvalidationKeys('order-1', 'ship-1')).toEqual([
      ['order', 'order-1'],
      ['shipments', 'order-1'],
      ['shipment', 'ship-1'],
      ['disputes', 'order-1'],
      ['my-purchases'],
    ]);
  });
});
