import { describe, expect, it } from 'bun:test';

import { createResolveShipmentTrackingUrlHandler } from './handler.ts';

const shipmentId = 'c61db80d-30df-4f93-8a3f-52e3708c3f42';

const requestFor = () =>
  new Request('https://example.com/functions/v1/resolve-shipment-tracking-url', {
    method: 'POST',
    body: JSON.stringify({ shipmentId }),
  });

const subject = {
  sellerId: 'seller-1',
  buyerId: 'buyer-1',
  trackingNumber: 'TRACK-1',
};

describe('resolve shipment tracking URL handler', () => {
  it('rejects an unauthenticated caller before loading a shipment', async () => {
    let loaded = false;
    const handler = createResolveShipmentTrackingUrlHandler({
      authenticate: async () => null,
      loadSubject: async () => {
        loaded = true;
        return subject;
      },
      loadRole: async () => null,
      resolveUrl: () => 'https://test.envia.com/rastreo?label=TRACK-1',
    });

    const response = await handler(requestFor());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(loaded).toBe(false);
  });

  it('returns the canonical URL for an authorized buyer', async () => {
    const handler = createResolveShipmentTrackingUrlHandler({
      authenticate: async () => ({ id: 'buyer-1' }),
      loadSubject: async () => subject,
      loadRole: async () => null,
      resolveUrl: (trackingNumber) =>
        `https://test.envia.com/rastreo?label=${trackingNumber}`,
    });

    const response = await handler(requestFor());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://test.envia.com/rastreo?label=TRACK-1',
    });
  });

  it('returns the canonical URL for an authorized seller', async () => {
    const handler = createResolveShipmentTrackingUrlHandler({
      authenticate: async () => ({ id: 'seller-1' }),
      loadSubject: async () => subject,
      loadRole: async () => null,
      resolveUrl: (trackingNumber) =>
        `https://test.envia.com/rastreo?label=${trackingNumber}`,
    });

    const response = await handler(requestFor());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://test.envia.com/rastreo?label=TRACK-1',
    });
  });

  it('allows an admin but refuses an unrelated authenticated user', async () => {
    const adminHandler = createResolveShipmentTrackingUrlHandler({
      authenticate: async () => ({ id: 'admin-1' }),
      loadSubject: async () => subject,
      loadRole: async () => 'admin',
      resolveUrl: () => 'https://envia.com/rastreo?label=TRACK-1',
    });
    const outsiderHandler = createResolveShipmentTrackingUrlHandler({
      authenticate: async () => ({ id: 'outsider-1' }),
      loadSubject: async () => subject,
      loadRole: async () => 'user',
      resolveUrl: () => 'https://envia.com/rastreo?label=TRACK-1',
    });

    expect((await adminHandler(requestFor())).status).toBe(200);
    const outsiderResponse = await outsiderHandler(requestFor());
    expect(outsiderResponse.status).toBe(403);
    expect(await outsiderResponse.json()).toEqual({ error: 'FORBIDDEN' });
  });
});
