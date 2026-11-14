import { describe, expect, it } from 'bun:test';

import { priceRangeFilterCents, searchSortOrder } from './search-price-query';

describe('priceRangeFilterCents', () => {
  it('converts the pesos slider range to price_cents bounds', () => {
    expect(priceRangeFilterCents([0, 50_000])).toEqual({
      column: 'price_cents',
      minCents: 0,
      maxCents: 5_000_000,
    });
  });

  it('keeps odd pesos values exact', () => {
    expect(priceRangeFilterCents([150.5, 19.99])).toEqual({
      column: 'price_cents',
      minCents: 15_050,
      maxCents: 1_999,
    });
  });

  it('rejects a negative slider bound', () => {
    expect(() => priceRangeFilterCents([-1, 100])).toThrow(
      'INVALID_PESOS_AMOUNT',
    );
  });
});

describe('searchSortOrder', () => {
  it('sorts by price_cents ascending and descending', () => {
    expect(searchSortOrder('price_asc')).toEqual({
      column: 'price_cents',
      ascending: true,
    });
    expect(searchSortOrder('price_desc')).toEqual({
      column: 'price_cents',
      ascending: false,
    });
  });

  it('sorts newest first by default', () => {
    expect(searchSortOrder('newest')).toEqual({
      column: 'created_at',
      ascending: false,
    });
    expect(searchSortOrder(undefined)).toEqual({
      column: 'created_at',
      ascending: false,
    });
  });
});
