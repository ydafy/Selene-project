import { describe, expect, test } from 'bun:test';

import {
  resolveProductsQueryEnabled,
  resolveProductStatuses,
} from './useProducts.helpers';

describe('resolveProductsQueryEnabled', () => {
  test('defaults to enabled for existing catalog consumers', () => {
    expect(resolveProductsQueryEnabled(undefined)).toBe(true);
    expect(resolveProductsQueryEnabled({ verifiedOnly: true })).toBe(true);
  });

  test('honors an explicit disabled guard for invalid public profile routes', () => {
    expect(
      resolveProductsQueryEnabled({ sellerId: undefined, enabled: false }),
    ).toBe(false);
    expect(
      resolveProductsQueryEnabled({ sellerId: 'seller-1', enabled: true }),
    ).toBe(true);
  });
});

describe('resolveProductStatuses', () => {
  test('defaults to VERIFIED and SOLD so home keeps its current lists', () => {
    expect(resolveProductStatuses(undefined)).toEqual(['VERIFIED', 'SOLD']);
    expect(resolveProductStatuses({ verifiedOnly: true })).toEqual([
      'VERIFIED',
      'SOLD',
    ]);
  });

  test('uses the statuses a screen asks for', () => {
    expect(
      resolveProductStatuses({
        statuses: ['VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW'],
      }),
    ).toEqual(['VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW']);
  });
});
