import { describe, expect, it } from 'bun:test';

import {
  ApiError,
  buildDisputeInsert,
  parseCreateDisputeRequestBody,
  validateShipmentDisputeContext,
} from './create-dispute';

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  buyer_id: 'buyer-1',
  status: 'shipped',
  delivered_at: null,
};

const shipment = {
  id: '22222222-2222-4222-8222-222222222222',
  order_id: order.id,
  seller_id: 'seller-from-shipment',
};

const evidence = {
  images: ['https://example.com/evidence.jpg'],
  tech_checklist: { powers_on: false },
  video_url: null,
};

describe('parseCreateDisputeRequestBody', () => {
  it('rejects dispute requests without shipmentId', () => {
    expect(() =>
      parseCreateDisputeRequestBody({
        orderId: order.id,
        reason: 'not_as_described',
        description: 'The component does not match the listing.',
        evidence,
      }),
    ).toThrow('Required');
  });
});

describe('validateShipmentDisputeContext', () => {
  it('rejects a shipment that does not belong to the disputed order', () => {
    expect(() =>
      validateShipmentDisputeContext({
        userId: 'buyer-1',
        order,
        shipment: {
          ...shipment,
          order_id: '33333333-3333-4333-8333-333333333333',
        },
      }),
    ).toThrow(new ApiError(400, 'SHIPMENT_ORDER_MISMATCH'));
  });

  it('rejects a buyer that does not own the order before dispute insert', () => {
    expect(() =>
      validateShipmentDisputeContext({
        userId: 'other-buyer',
        order,
        shipment,
      }),
    ).toThrow(new ApiError(403, 'ORDER_BUYER_MISMATCH'));
  });
});

describe('buildDisputeInsert', () => {
  it('derives seller_id from shipments.seller_id and includes shipment_id', () => {
    expect(
      buildDisputeInsert({
        order,
        shipment,
        buyerId: 'buyer-1',
        reason: 'not_as_described',
        description: 'The component does not match the listing.',
        evidence,
      }),
    ).toEqual({
      order_id: order.id,
      shipment_id: shipment.id,
      buyer_id: 'buyer-1',
      seller_id: 'seller-from-shipment',
      reason: 'not_as_described',
      description: 'The component does not match the listing.',
      buyer_evidence: evidence,
      status: 'open',
    });
  });
});
