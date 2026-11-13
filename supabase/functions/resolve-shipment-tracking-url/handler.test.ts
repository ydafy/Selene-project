import { describe, expect, it } from 'bun:test';

import { createResolveShipmentTrackingUrlHandler } from './handler.ts';

const shipmentId = 'c61db80d-30df-4f93-8a3f-52e3708c3f42';

const requestFor = () =>
  new Request(
    'https://example.com/functions/v1/resolve-shipment-tracking-url',
    {
      method: 'POST',
      body: JSON.stringify({ shipmentId }),
    },
  );

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
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
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

describe('resolve shipment tracking URL request validation', () => {
  const recordingHandler = () => {
    const calls: string[] = [];
    const handler = createResolveShipmentTrackingUrlHandler({
      authenticate: async () => {
        calls.push('authenticate');
        return { id: 'buyer-1' };
      },
      loadSubject: async () => {
        calls.push('loadSubject');
        return subject;
      },
      loadRole: async () => {
        calls.push('loadRole');
        return null;
      },
      resolveUrl: () => 'https://test.envia.com/rastreo?label=TRACK-1',
    });
    return { handler, calls };
  };

  const post = (body: string) =>
    new Request(
      'https://example.com/functions/v1/resolve-shipment-tracking-url',
      { method: 'POST', body },
    );

  it.each([
    ['a v1', 'c61db80d-30df-1f93-8a3f-52e3708c3f42'],
    ['a v4', 'c61db80d-30df-4f93-8a3f-52e3708c3f42'],
    ['a v5', 'c61db80d-30df-5f93-8a3f-52e3708c3f42'],
    ['a v7', '019a6f3e-8c1d-7b2a-9f3e-52e3708c3f42'],
    ['a v8', 'c61db80d-30df-8f93-8a3f-52e3708c3f42'],
  ])('accepts %s shipment id and looks it up', async (_case, id) => {
    const { handler, calls } = recordingHandler();

    const response = await handler(post(JSON.stringify({ shipmentId: id })));

    expect(response.status).toBe(200);
    expect(calls).toEqual(['authenticate', 'loadSubject', 'loadRole']);
  });

  it.each([
    [
      'a shipment id with a non-RFC variant',
      JSON.stringify({ shipmentId: '11111111-2222-3333-4444-555555555555' }),
    ],
    [
      'a shipment id with version 9',
      JSON.stringify({ shipmentId: 'c61db80d-30df-9f93-8a3f-52e3708c3f42' }),
    ],
    [
      'a shipment id that is not a UUID',
      JSON.stringify({ shipmentId: 'shipment-1' }),
    ],
    ['a shipment id that is not a string', JSON.stringify({ shipmentId: 1 })],
    ['a body without a shipment id', JSON.stringify({})],
    ['a body that is not JSON', 'not json'],
  ])(
    'answers 400 INVALID_SHIPMENT_ID for %s before authenticating',
    async (_case, body) => {
      const { handler, calls } = recordingHandler();

      const response = await handler(post(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'INVALID_SHIPMENT_ID' });
      expect(calls).toEqual([]);
    },
  );

  it.each(['GET', 'OPTIONS', 'PUT'])(
    'answers 405 METHOD_NOT_ALLOWED to %s before reading the body or authenticating',
    async (method) => {
      const { handler, calls } = recordingHandler();

      const response = await handler(
        new Request(
          'https://example.com/functions/v1/resolve-shipment-tracking-url',
          {
            method,
            body:
              method === 'GET' || method === 'OPTIONS'
                ? undefined
                : JSON.stringify({ shipmentId }),
          },
        ),
      );

      expect(response.status).toBe(405);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(await response.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' });
      expect(calls).toEqual([]);
    },
  );
});
