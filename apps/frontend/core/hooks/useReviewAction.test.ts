import { describe, expect, test } from 'bun:test';

import { buildReviewInsertPayload } from './useReviewAction.helpers';

describe('buildReviewInsertPayload', () => {
  test('maps a shipment-linked review to a supabase insert payload with linkage', () => {
    const payload = buildReviewInsertPayload({
      orderId: 'order-1',
      rating: 5,
      comment: 'Excellent sale',
      sellerId: 'seller-1',
      reviewerId: 'buyer-1',
      shipmentId: 'shipment-1',
      productId: 'product-1',
    });

    expect(payload).toEqual({
      order_id: 'order-1',
      seller_id: 'seller-1',
      reviewer_id: 'buyer-1',
      rating: 5,
      comment: 'Excellent sale',
      shipment_id: 'shipment-1',
      product_id: 'product-1',
    });
  });

  test('writes explicit null linkage for legacy reviews without shipment/product identity', () => {
    const payload = buildReviewInsertPayload({
      orderId: 'order-2',
      rating: 4,
      comment: '',
      sellerId: 'seller-2',
      reviewerId: 'buyer-2',
    });

    expect(payload).toEqual({
      order_id: 'order-2',
      seller_id: 'seller-2',
      reviewer_id: 'buyer-2',
      rating: 4,
      comment: '',
      shipment_id: null,
      product_id: null,
    });
  });
});