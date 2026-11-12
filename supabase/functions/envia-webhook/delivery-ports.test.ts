import { describe, expect, it } from 'bun:test';

import {
  createWebhookDeliveryPorts,
  sha256Hex,
  type DeliveryRpcClient,
} from './delivery-ports.ts';

const BODY = '{"type":"tracking.simple"}';

function fakeAdmin(result: { data: unknown; error: unknown }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const admin: DeliveryRpcClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return result as never;
    },
  };
  return { admin, calls };
}

describe('sha256Hex', () => {
  it('hashes the raw body as lowercase hex', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('createWebhookDeliveryPorts.claim', () => {
  it('claims through fn_claim_envia_webhook_delivery with the payload hash, never a table write', async () => {
    const { admin, calls } = fakeAdmin({
      data: [{ kind: 'new', id: 'delivery-uuid' }],
      error: null,
    });
    const ports = createWebhookDeliveryPorts(admin);

    expect(
      await ports.claim({
        deliveryId: 'envia-1',
        eventName: 'tracking.simple',
        rawBody: BODY,
      }),
    ).toEqual({ kind: 'new', id: 'delivery-uuid' });
    expect(calls).toEqual([
      {
        name: 'fn_claim_envia_webhook_delivery',
        args: {
          p_delivery_id: 'envia-1',
          p_event_name: 'tracking.simple',
          p_payload_sha256: await sha256Hex(BODY),
        },
      },
    ]);
  });

  it('maps a duplicate and a collision to their kinds without an id', async () => {
    for (const kind of ['duplicate', 'collision'] as const) {
      const { admin } = fakeAdmin({ data: [{ kind, id: null }], error: null });
      expect(
        await createWebhookDeliveryPorts(admin).claim({
          deliveryId: 'envia-1',
          eventName: 'tracking.simple',
          rawBody: BODY,
        }),
      ).toEqual({ kind });
    }
  });

  it('throws DELIVERY_CLAIM_FAILED on an RPC error or an unusable result', async () => {
    const results = [
      { data: null, error: { code: '42501', message: 'denied' } },
      { data: [], error: null },
      { data: [{ kind: 'new', id: null }], error: null },
      { data: [{ kind: 'other', id: 'x' }], error: null },
      { data: null, error: null },
    ];
    for (const result of results) {
      const { admin } = fakeAdmin(result);
      await expect(
        createWebhookDeliveryPorts(admin).claim({
          deliveryId: 'envia-1',
          eventName: 'tracking.simple',
          rawBody: BODY,
        }),
      ).rejects.toThrow('DELIVERY_CLAIM_FAILED');
    }
  });
});

describe('createWebhookDeliveryPorts.mark', () => {
  it('marks a processed delivery through fn_mark_webhook_delivery without an error code', async () => {
    const { admin, calls } = fakeAdmin({ data: null, error: null });
    await createWebhookDeliveryPorts(admin).mark({
      deliveryId: 'delivery-uuid',
      state: 'processed',
    });
    expect(calls).toEqual([
      {
        name: 'fn_mark_webhook_delivery',
        args: {
          p_delivery_id: 'delivery-uuid',
          p_state: 'processed',
          p_error_code: null,
        },
      },
    ]);
  });

  it('marks a failed delivery with its error code', async () => {
    const { admin, calls } = fakeAdmin({ data: null, error: null });
    await createWebhookDeliveryPorts(admin).mark({
      deliveryId: 'delivery-uuid',
      state: 'failed',
      errorCode: 'TRACKING_SUBJECT_NOT_UNIQUE',
    });
    expect(calls[0].args).toEqual({
      p_delivery_id: 'delivery-uuid',
      p_state: 'failed',
      p_error_code: 'TRACKING_SUBJECT_NOT_UNIQUE',
    });
  });

  it('throws the database error when the mark is refused', async () => {
    const error = { code: 'P0001', message: 'INVALID_ARGUMENT' };
    const { admin } = fakeAdmin({ data: null, error });
    await expect(
      createWebhookDeliveryPorts(admin).mark({
        deliveryId: 'delivery-uuid',
        state: 'processed',
      }),
    ).rejects.toEqual(error);
  });
});
