import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ApiError,
  mapDisputeErrorCode,
  parseCreateDisputeRequestBody,
} from './create-dispute';

const evidence = {
  images: ['https://example.com/evidence.jpg'],
  tech_checklist: { powers_on: false },
  video_url: null,
};

describe('parseCreateDisputeRequestBody', () => {
  it('rejects dispute requests without shipmentId', () => {
    expect(() =>
      parseCreateDisputeRequestBody({
        orderId: '11111111-1111-4111-8111-111111111111',
        reason: 'not_as_described',
        description: 'The component does not match the listing.',
        evidence,
      }),
    ).toThrow('Required');
  });
});

describe('mapDisputeErrorCode', () => {
  it.each([
    ['SHIPMENT_NOT_FOUND', 404, 'Envío no encontrado'],
    ['SHIPMENT_ORDER_MISMATCH', 400, 'SHIPMENT_ORDER_MISMATCH'],
    ['ORDER_BUYER_MISMATCH', 403, 'ORDER_BUYER_MISMATCH'],
    ['DISPUTE_STATUS_NOT_ALLOWED:completed', 422, 'DISPUTE_STATUS_NOT_ALLOWED:completed'],
    ['DISPUTE_WINDOW_EXPIRED', 422, 'DISPUTE_WINDOW_EXPIRED'],
    ['SHIPMENT_CANCELLATION_OPERATION_ACTIVE', 409, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'],
    ['DISPUTE_ALREADY_EXISTS', 409, 'Ya existe una disputa abierta para este paquete.'],
  ])('maps %s to HTTP %d', (code, status, message) => {
    expect(mapDisputeErrorCode(code)).toEqual(new ApiError(status, message));
  });

  it('maps an unknown code to a 500', () => {
    const error = mapDisputeErrorCode('SOMETHING_ELSE');
    expect(error.status).toBe(500);
    expect(error.message).toBe('Error al crear disputa: SOMETHING_ELSE');
  });
});

describe('Edge notice cutover', () => {
  it('does not insert post-commit notifications', () => {
    const source = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');
    expect(source).toContain('.rpc(');
    expect(source).toContain("'fn_open_shipment_dispute'");
    expect(source).not.toContain(".from('disputes')");
    expect(source).not.toMatch(/\.from\('notifications'\)|const notifications =/);
  });
});
