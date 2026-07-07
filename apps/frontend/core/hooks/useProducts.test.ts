import { describe, expect, test } from 'bun:test';

import { resolveProductsQueryEnabled } from './useProducts.helpers';

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
