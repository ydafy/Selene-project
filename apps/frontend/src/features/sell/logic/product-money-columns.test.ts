import { describe, expect, it } from 'bun:test';

import { productMoneyColumns } from './product-money-columns';

describe('productMoneyColumns', () => {
  it('writes the pesos form inputs as integer cents columns', () => {
    expect(
      productMoneyColumns({ price: '1000.00', shipping_cost: '150.5' }),
    ).toEqual({ price_cents: 100_000, shipping_cost_cents: 15_050 });
  });

  it('keeps float noise out of the cents', () => {
    expect(
      productMoneyColumns({ price: '19.99', shipping_cost: '0.29' }),
    ).toEqual({ price_cents: 1_999, shipping_cost_cents: 29 });
  });

  it('writes zero shipping when the quote is empty', () => {
    expect(productMoneyColumns({ price: '500', shipping_cost: '' })).toEqual({
      price_cents: 50_000,
      shipping_cost_cents: 0,
    });
  });

  it('rejects a price that is not a pesos amount', () => {
    expect(() =>
      productMoneyColumns({ price: 'abc', shipping_cost: '150' }),
    ).toThrow('INVALID_PESOS_AMOUNT');
  });
});
