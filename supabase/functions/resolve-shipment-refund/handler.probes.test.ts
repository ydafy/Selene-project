import { describe, expect, it } from 'bun:test';

import { createResolveShipmentRefundHandler, type ResolveShipmentRefundDeps } from './handler.ts';

// Verifier probes (B2.3.1, S3/S8): order of checks, CORS on errors, and no body or RPC work for non-admins.
const SHIPMENT = '7b310000-0000-4000-8000-000000000011';
const ADMIN = '00000000-0000-4000-8000-000000000001';

function deps(overrides: Partial<ResolveShipmentRefundDeps> = {}) {
  const calls: string[] = [];
  const base: ResolveShipmentRefundDeps = {
    getUserId: async () => { calls.push('getUserId'); return ADMIN; },
    isAdmin: async () => { calls.push('isAdmin'); return true; },
    resolveRefund: async (input) => {
      calls.push(`resolve:${input.shipmentId}:${input.reference}`);
      return { data: { resolved: true, shipment_cancelled: false, amount_owed_cents: 11000, reference: input.reference }, error: null };
    },
    log: () => undefined,
  };
  return { calls, handler: createResolveShipmentRefundHandler({ ...base, ...overrides }) };
}

const post = (body: string, auth = 'Bearer jwt') =>
  new Request('http://localhost/functions/v1/resolve-shipment-refund', {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body });

describe('resolve-shipment-refund verifier probes', () => {
  it('a suspended or banned admin (isAdmin false) gets 403 ADMIN_ONLY with CORS headers and no RPC call', async () => {
    const { handler, calls } = deps({ isAdmin: async () => false });
    const response = await handler(post(JSON.stringify({ shipment_id: SHIPMENT, reference: 'R' })));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ADMIN_ONLY' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(calls).toEqual(['getUserId']);
  });

  it('the admin check runs before the body is read: a non-admin with a huge invalid body is still 403', async () => {
    const { handler } = deps({ isAdmin: async () => false });
    const response = await handler(post('{'.repeat(10_000)));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ADMIN_ONLY' });
  });

  it('tabs and newlines around the reference are trimmed before the RPC (SQL btrim only strips spaces)', async () => {
    const { handler, calls } = deps();
    const response = await handler(post(JSON.stringify({ shipment_id: SHIPMENT, reference: '\t SPEI-1 \n' })));
    expect(response.status).toBe(200);
    expect(calls.at(-1)).toBe(`resolve:${SHIPMENT}:SPEI-1`);
  });

  it('an uppercase uuid is accepted and passed through unchanged', async () => {
    const { handler, calls } = deps();
    const response = await handler(post(JSON.stringify({ shipment_id: SHIPMENT.toUpperCase(), reference: 'R' })));
    expect(response.status).toBe(200);
    expect(calls.at(-1)).toBe(`resolve:${SHIPMENT.toUpperCase()}:R`);
  });

  it('a getUserId failure (throws) is 500 INTERNAL_ERROR, never the raw text', async () => {
    const { handler } = deps({ getUserId: async () => { throw new Error('gotrue 10.0.0.9 down'); } });
    const response = await handler(post(JSON.stringify({ shipment_id: SHIPMENT, reference: 'R' })));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toBe('{"error":"INTERNAL_ERROR"}');
  });
});
