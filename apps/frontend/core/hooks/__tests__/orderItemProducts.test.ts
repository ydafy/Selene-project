import { describe, expect, it } from 'bun:test';

import {
  ITEM_PRODUCT_EMBED,
  mergeItemProducts,
} from '../orderItemProducts';

describe('mergeItemProducts', () => {
  it('keeps the table row when RLS shows it (owner or admin)', () => {
    const item = {
      id: 'i1',
      product: { id: 'p1', origin_zip: '01000' },
      public_product: { id: 'p1' },
    };

    mergeItemProducts(item);

    expect(item as unknown).toEqual({ id: 'i1', product: { id: 'p1', origin_zip: '01000' } });
  });

  it('falls back to the view row when the table row is hidden (buyer)', () => {
    const item = { id: 'i1', product: null, public_product: { id: 'p1' } };

    mergeItemProducts(item);

    expect(item as unknown).toEqual({ id: 'i1', product: { id: 'p1' } });
  });

  it('leaves product null when neither embed returns a row', () => {
    const item = { id: 'i1', product: null, public_product: null };

    mergeItemProducts(item);

    expect(item as unknown).toEqual({ id: 'i1', product: null });
  });

  it('merges items nested in shipments and arrays', () => {
    const order = {
      items: [{ product: null, public_product: { id: 'p1' } }],
      shipments: [
        { items: [{ product: { id: 'p2' }, public_product: { id: 'p2' } }] },
      ],
    };

    mergeItemProducts(order);

    expect(order as unknown).toEqual({
      items: [{ product: { id: 'p1' } }],
      shipments: [{ items: [{ product: { id: 'p2' } }] }],
    });
  });

  it('does not touch objects without a view embed', () => {
    const sale = { product: { id: 'p1' }, order: { id: 'o1' } };

    mergeItemProducts(sale);

    expect(sale).toEqual({ product: { id: 'p1' }, order: { id: 'o1' } });
  });

  it('asks for the table row and the view row', () => {
    expect(ITEM_PRODUCT_EMBED).toBe(
      'product:products(*), public_product:products_public(*)',
    );
  });
});
