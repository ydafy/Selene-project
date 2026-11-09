import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ApiError,
  assertOwnDisputeEvidence,
  mapDisputeErrorCode,
  parseCreateDisputeRequestBody,
} from './create-dispute';

const orderId = '11111111-1111-4111-8111-111111111111';
const buyerId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const ownPath = (file: string) => `disputes/${orderId}/${buyerId}/${file}`;

const evidence = {
  images: [ownPath('slot_0_1.jpg')],
  tech_checklist: { powers_on: false },
  video_url: null,
};

const withEvidence = (images: string[], video_url: string | null = null) => ({
  images,
  tech_checklist: { powers_on: false },
  video_url,
});

const rejection = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
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

  it('keeps evidence paths unchanged after parsing', () => {
    const parsed = parseCreateDisputeRequestBody({
      orderId,
      shipmentId: '44444444-4444-4444-8444-444444444444',
      reason: 'not_as_described',
      description: 'The component does not match the listing.',
      evidence: withEvidence(
        [ownPath('slot_0_1.jpg')],
        ownPath('unboxing_1.mp4'),
      ),
    });

    expect(parsed.evidence).toEqual(
      withEvidence([ownPath('slot_0_1.jpg')], ownPath('unboxing_1.mp4')),
    );
  });
});

describe('assertOwnDisputeEvidence', () => {
  it("accepts images and a video stored under the caller's folder for the order", () => {
    expect(() =>
      assertOwnDisputeEvidence(
        withEvidence(
          [ownPath('slot_0_1.jpg'), ownPath('slot_1_2.jpg')],
          ownPath('unboxing_3.mov'),
        ),
        orderId,
        buyerId,
      ),
    ).not.toThrow();
    expect(() =>
      assertOwnDisputeEvidence(
        withEvidence([ownPath('slot_0_1.jpg')]),
        orderId,
        buyerId,
      ),
    ).not.toThrow();
  });

  it.each([
    ['another user folder', `disputes/${orderId}/${otherId}/slot_0_1.jpg`],
    ['another order folder', `disputes/${otherId}/${buyerId}/slot_0_1.jpg`],
    ['another evidence folder', `shipments/${orderId}/${buyerId}/slot_0_1.jpg`],
    [
      'a URL',
      `https://example.test/storage/v1/object/public/evidence/${ownPath('a.jpg')}`,
    ],
    ['a parent segment', `disputes/${orderId}/${buyerId}/../a.jpg`],
    ['a leading slash', `/${ownPath('a.jpg')}`],
    ['a nested folder', ownPath('nested/a.jpg')],
    ['a missing file name', `disputes/${orderId}/${buyerId}/`],
  ])('rejects an image in %s with a 400', (_case, path) => {
    const error = rejection(() =>
      assertOwnDisputeEvidence(withEvidence([path]), orderId, buyerId),
    );
    expect(error).toEqual(
      new ApiError(400, 'Evidence images must be your uploads for this order'),
    );
  });

  it('rejects a valid image list with a foreign video with a 400', () => {
    const error = rejection(() =>
      assertOwnDisputeEvidence(
        withEvidence(
          [ownPath('slot_0_1.jpg')],
          `disputes/${orderId}/${otherId}/unboxing_1.mp4`,
        ),
        orderId,
        buyerId,
      ),
    );
    expect(error).toEqual(
      new ApiError(400, 'Evidence video must be your upload for this order'),
    );
  });
});

describe('mapDisputeErrorCode', () => {
  it.each([
    ['SHIPMENT_NOT_FOUND', 404, 'Envío no encontrado'],
    ['SHIPMENT_ORDER_MISMATCH', 400, 'SHIPMENT_ORDER_MISMATCH'],
    ['ORDER_BUYER_MISMATCH', 403, 'ORDER_BUYER_MISMATCH'],
    [
      'DISPUTE_STATUS_NOT_ALLOWED:completed',
      422,
      'DISPUTE_STATUS_NOT_ALLOWED:completed',
    ],
    ['DISPUTE_WINDOW_EXPIRED', 422, 'DISPUTE_WINDOW_EXPIRED'],
    [
      'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
      409,
      'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
    ],
    [
      'DISPUTE_ALREADY_EXISTS',
      409,
      'Ya existe una disputa abierta para este paquete.',
    ],
  ])('maps %s to HTTP %d', (code, status, message) => {
    expect(mapDisputeErrorCode(code)).toEqual(new ApiError(status, message));
  });

  it('maps an unknown code to a 500', () => {
    const error = mapDisputeErrorCode('SOMETHING_ELSE');
    expect(error.status).toBe(500);
    expect(error.message).toBe('Error al crear disputa: SOMETHING_ELSE');
  });
});

describe('evidence check placement', () => {
  it('checks evidence ownership after authentication and before opening the dispute', () => {
    const source = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');
    const check = source.indexOf(
      'assertOwnDisputeEvidence(evidence, orderId, user.id)',
    );
    expect(check).toBeGreaterThan(
      source.indexOf("throw new ApiError(401, 'AUTH_REQUIRED')"),
    );
    expect(check).toBeLessThan(source.indexOf('.rpc('));
  });
});

describe('Edge notice cutover', () => {
  it('does not insert post-commit notifications', () => {
    const source = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8');
    expect(source).toContain('.rpc(');
    expect(source).toContain("'fn_open_shipment_dispute'");
    expect(source).not.toContain(".from('disputes')");
    expect(source).not.toMatch(
      /\.from\('notifications'\)|const notifications =/,
    );
  });
});
