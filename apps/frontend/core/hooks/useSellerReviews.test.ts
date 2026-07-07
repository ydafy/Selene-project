import { describe, expect, test } from 'bun:test';

import { normalizeSellerReviewRows } from './useSellerReviews.helpers';

describe('normalizeSellerReviewRows', () => {
  test('marks linked reviews as verified purchases and preserves linkage fields', () => {
    const result = normalizeSellerReviewRows([
      {
        id: 'review-linked',
        created_at: '2026-06-01T12:00:00.000Z',
        rating: 5,
        comment: 'Excellent seller',
        shipment_id: 'shipment-1',
        product_id: 'product-1',
        reviewer: { username: 'buyer', avatar_url: null },
        product: { name: 'RTX 4090' },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'review-linked',
      shipment_id: 'shipment-1',
      product_id: 'product-1',
      isVerifiedPurchase: true,
      comment: 'Excellent seller',
    });
  });

  test('keeps legacy comment reviews visible without verified badge', () => {
    const result = normalizeSellerReviewRows([
      {
        id: 'review-legacy',
        created_at: '2026-06-02T12:00:00.000Z',
        rating: 4,
        comment: 'Good communication',
        shipment_id: null,
        product_id: null,
        reviewer: { username: null, avatar_url: null },
        product: null,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].isVerifiedPurchase).toBe(false);
    expect(result[0].comment).toBe('Good communication');
  });

  test('filters rating-only reviews from cards while preserving nullable comments contract', () => {
    const result = normalizeSellerReviewRows([
      {
        id: 'rating-only-null',
        created_at: '2026-06-03T12:00:00.000Z',
        rating: 3,
        comment: null,
        shipment_id: 'shipment-2',
        product_id: 'product-2',
        reviewer: { username: 'quiet', avatar_url: null },
        product: { name: 'Ryzen 7' },
      },
      {
        id: 'rating-only-empty',
        created_at: '2026-06-04T12:00:00.000Z',
        rating: 2,
        comment: '   ',
        shipment_id: null,
        product_id: null,
        reviewer: null,
        product: null,
      },
      {
        id: 'comment-review',
        created_at: '2026-06-05T12:00:00.000Z',
        rating: 5,
        comment: 'Fast shipping',
        shipment_id: null,
        product_id: null,
        reviewer: null,
        product: null,
      },
    ]);

    expect(result.map((review) => review.id)).toEqual(['comment-review']);
    expect(result[0].comment).toBe('Fast shipping');
  });
});
