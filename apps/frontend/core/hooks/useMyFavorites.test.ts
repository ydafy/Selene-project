import { expect, test, describe } from 'bun:test';
import { fetchMyFavorites } from './fetchMyFavorites';

// Test doubles use a minimal chainable interface — not a full SupabaseClient.
// The pure function accepts any object with the query builder methods it calls.
interface MockSupabaseQuery {
  from: () => MockSupabaseQuery;
  select: () => MockSupabaseQuery;
  eq: () => MockSupabaseQuery;
  is: () => MockSupabaseQuery;
  order: () => MockSupabaseQuery;
  limit: (n: number) => MockSupabaseQuery;
  then: (cb: (v: any) => any) => Promise<any>;
}

function createMockClient(response: {
  data?: any[];
  count?: number;
  error?: any;
}): MockSupabaseQuery {
  const chain: MockSupabaseQuery = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (cb: (v: any) => any) =>
      Promise.resolve(
        cb({
          data: response.data || [],
          count: response.count ?? 0,
          error: response.error ?? null,
        }),
      ),
  };
  return chain;
}

describe('fetchMyFavorites', () => {
  test('default call applies limit of 6', async () => {
    const limitCalls: number[] = [];
    const mockClient = createMockClient({ count: 5 });
    const originalLimit = mockClient.limit;
    mockClient.limit = (n: number) => {
      limitCalls.push(n);
      return mockClient;
    };

    await fetchMyFavorites('user-123', undefined, mockClient as any);

    expect(limitCalls).toEqual([6]);
  });

  test('custom limit applies the provided value', async () => {
    const limitCalls: number[] = [];
    const mockClient = createMockClient({ count: 3 });
    mockClient.limit = (n: number) => {
      limitCalls.push(n);
      return mockClient;
    };

    await fetchMyFavorites('user-123', 10, mockClient as any);

    expect(limitCalls).toEqual([10]);
  });

  test('limit of 0 omits the limit call entirely', async () => {
    const limitCalls: number[] = [];
    const mockClient = createMockClient({ count: 12 });
    mockClient.limit = (n: number) => {
      limitCalls.push(n);
      return mockClient;
    };

    await fetchMyFavorites('user-123', 0, mockClient as any);

    expect(limitCalls).toEqual([]);
  });

  test('returns mapped products from response', async () => {
    const mockProducts = [
      { id: 'p1', name: 'RTX 4090' },
      { id: 'p2', name: 'RX 7900 XTX' },
    ];
    const mockClient = createMockClient({
      data: mockProducts.map((p) => ({ product: p })),
      count: 2,
    });

    const result = await fetchMyFavorites('user-123', undefined, mockClient as any);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('p1');
    expect(result[1].id).toBe('p2');
  });
});