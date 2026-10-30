import { describe, expect, test } from 'bun:test';
import { productsListKey } from '../productQueryKeys';

describe('productsListKey', () => {
  test('starts with the products prefix', () => {
    expect(productsListKey({ limit: 5 })[0]).toBe('products');
    expect(productsListKey()[0]).toBe('products');
  });

  test('ignores options that do not change the data', () => {
    const filters = { sellerId: 's1', limit: 10, verifiedOnly: true };
    expect(productsListKey({ ...filters, enabled: false })).toEqual(
      productsListKey({ ...filters, enabled: true }),
    );
    expect(productsListKey({ ...filters, enabled: false })).toEqual(
      productsListKey(filters),
    );
  });

  test('maps unset and default filters to the same key', () => {
    expect(productsListKey()).toEqual(productsListKey({}));
    expect(productsListKey({ verifiedOnly: false })).toEqual(productsListKey());
    expect(productsListKey({ statuses: ['VERIFIED', 'SOLD'] })).toEqual(
      productsListKey(),
    );
  });

  test('different filters produce different keys', () => {
    const keys = [
      productsListKey(),
      productsListKey({ sellerId: 's1' }),
      productsListKey({ sellerId: 's2' }),
      productsListKey({ limit: 5 }),
      productsListKey({ verifiedOnly: true }),
      productsListKey({ statuses: ['HIDDEN'] }),
    ].map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
