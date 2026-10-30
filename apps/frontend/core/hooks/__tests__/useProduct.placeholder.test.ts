import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { productsListKey } from '../productQueryKeys';
import { findCachedProduct } from '../productQueryKeys';

const product = (id: string) => ({ id, title: `Product ${id}` });

describe('findCachedProduct', () => {
  test('finds a product cached in a list under the list key', () => {
    const client = new QueryClient();
    client.setQueryData(productsListKey({ limit: 3 }), [
      product('a'),
      product('b'),
    ]);
    expect(findCachedProduct(client, 'b')).toEqual(product('b'));
  });

  test('returns undefined when the id is not cached', () => {
    const client = new QueryClient();
    client.setQueryData(productsListKey(), [product('a')]);
    expect(findCachedProduct(client, 'zzz')).toBeUndefined();
    expect(findCachedProduct(new QueryClient(), 'a')).toBeUndefined();
  });

  test('ignores non-array data under the prefix', () => {
    const client = new QueryClient();
    client.setQueryData(['products', 'nothing'], undefined);
    client.setQueryData(['products', 'obj'], { id: 'a' });
    client.setQueryData(['products', 'str'], 'a');
    client.setQueryData(['products', 'null'], null);
    client.setQueryData(['products', 'mixed'], [null, 3, product('c')]);
    expect(findCachedProduct(client, 'a')).toBeUndefined();
    expect(findCachedProduct(client, 'c')).toEqual(product('c'));
  });

  test('finds a product inside infinite query pages', () => {
    const client = new QueryClient();
    client.setQueryData(['products', 'inf'], {
      pages: [[product('a')], [product('d')]],
      pageParams: [0, 1],
    });
    expect(findCachedProduct(client, 'd')).toEqual(product('d'));
  });
});
