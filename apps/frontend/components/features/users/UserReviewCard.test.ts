import { describe, expect, test } from 'bun:test';

import { getUserReviewCardPresentation } from './UserReviewCard.helpers';

describe('getUserReviewCardPresentation', () => {
  test('describes verified linked reviews with product and localized date', () => {
    const result = getUserReviewCardPresentation(
      {
        id: 'review-linked',
        created_at: '2026-06-01T12:00:00.000Z',
        rating: 5,
        comment: 'Excellent seller',
        shipment_id: 'shipment-1',
        product_id: 'product-1',
        isVerifiedPurchase: true,
        reviewer: { username: 'buyer', avatar_url: null },
        product: { name: 'RTX 4090' },
      },
      'en-US',
      {
        userFallback: 'Customer',
        itemFallback: 'item',
        noComment: 'No comment provided',
        reviewFrom: 'Review from',
        rating: 'Rating',
        outOfFive: 'out of 5',
        reviewedOn: 'Reviewed on',
        comment: 'Comment',
        verifiedPurchase: 'Verified purchase',
      },
    );

    expect(result.shouldRender).toBe(true);
    expect(result.showVerifiedBadge).toBe(true);
    expect(result.formattedDate).toBe('Jun 1, 2026');
    expect(result.accessibilityLabel).toContain('Verified purchase: RTX 4090');
  });

  test('does not claim verification for legacy reviews', () => {
    const result = getUserReviewCardPresentation(
      {
        id: 'review-legacy',
        created_at: '2026-06-02T12:00:00.000Z',
        rating: 4,
        comment: 'Good communication',
        shipment_id: null,
        product_id: null,
        isVerifiedPurchase: false,
        reviewer: { username: null, avatar_url: null },
        product: null,
      },
      'en-US',
      {
        userFallback: 'Customer',
        itemFallback: 'item',
        noComment: 'No comment provided',
        reviewFrom: 'Review from',
        rating: 'Rating',
        outOfFive: 'out of 5',
        reviewedOn: 'Reviewed on',
        comment: 'Comment',
        verifiedPurchase: 'Verified purchase',
      },
    );

    expect(result.shouldRender).toBe(true);
    expect(result.showVerifiedBadge).toBe(false);
    expect(result.accessibilityLabel).not.toContain('Verified purchase');
  });

  test('does not render cards for reviews without comments', () => {
    const result = getUserReviewCardPresentation(
      {
        id: 'rating-only',
        created_at: '2026-06-03T12:00:00.000Z',
        rating: 3,
        comment: null,
        shipment_id: 'shipment-2',
        product_id: 'product-2',
        isVerifiedPurchase: true,
        reviewer: null,
        product: { name: 'Ryzen 7' },
      },
      'en-US',
      {
        userFallback: 'Customer',
        itemFallback: 'item',
        noComment: 'No comment provided',
        reviewFrom: 'Review from',
        rating: 'Rating',
        outOfFive: 'out of 5',
        reviewedOn: 'Reviewed on',
        comment: 'Comment',
        verifiedPurchase: 'Verified purchase',
      },
    );

    expect(result.shouldRender).toBe(false);
  });

  test('builds accessibility labels from localized copy', () => {
    const result = getUserReviewCardPresentation(
      {
        id: 'review-localized',
        created_at: '2026-06-04T12:00:00.000Z',
        rating: 5,
        comment: 'Muy buena atención',
        shipment_id: 'shipment-3',
        product_id: 'product-3',
        isVerifiedPurchase: true,
        reviewer: { username: 'comprador', avatar_url: null },
        product: { name: 'RX 7900 XT' },
      },
      'es-MX',
      {
        userFallback: 'Cliente',
        itemFallback: 'artículo',
        noComment: 'Sin comentario',
        reviewFrom: 'Reseña de',
        rating: 'Calificación',
        outOfFive: 'de 5',
        reviewedOn: 'Reseña del',
        comment: 'Comentario',
        verifiedPurchase: 'Compra verificada',
      },
    );

    expect(result.accessibilityLabel).toContain('Reseña de @comprador');
    expect(result.accessibilityLabel).toContain('Calificación: 5 de 5');
    expect(result.accessibilityLabel).toContain(
      'Compra verificada: RX 7900 XT',
    );
  });
});
