import { expect, test, describe } from 'bun:test';
import { fetchAllFavorites } from './fetchAllFavorites';

const PAGE_SIZE = 20;

// Test doubles use a minimal chainable interface — not a full SupabaseClient.
// The pure function accepts any object with the query builder methods it calls.
interface MockSupabaseQuery {
  from: () => MockSupabaseQuery;
  select: () => MockSupabaseQuery;
  eq: () => MockSupabaseQuery;
  is: () => MockSupabaseQuery;
  order: () => MockSupabaseQuery;
  range: (from: number, to: number) => MockSupabaseQuery;
  then: (cb: (v: any) => any) => Promise<any>;
}

function createMockClient(response: {
  data?: any[];
  count?: number;
  error?: any;
}): MockSupabaseQuery & { range: (from: number, to: number) => MockSupabaseQuery } {
  const chain: MockSupabaseQuery & { range: (from: number, to: number) => MockSupabaseQuery } = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    range: () => chain,
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

describe('fetchAllFavorites', () => {
  test('first page calls range(0, 19)', async () => {
    const rangeCalls: [number, number][] = [];
    const mockClient = createMockClient({
      data: [{ product: { id: 'p1' } }],
      count: 1,
    });
    mockClient.range = (from: number, to: number) => {
      rangeCalls.push([from, to]);
      return mockClient;
    };

    // Cast through unknown since the mock only implements the methods the function calls
    await fetchAllFavorites('user-123', 0, mockClient as any);

    expect(rangeCalls).toEqual([[0, 19]]);
  });

  test('pageParam=1 calls range(20, 39)', async () => {
    const rangeCalls: [number, number][] = [];
    const mockClient = createMockClient({
      data: [{ product: { id: 'p1' } }],
      count: 25,
    });
    mockClient.range = (from: number, to: number) => {
      rangeCalls.push([from, to]);
      return mockClient;
    };

    await fetchAllFavorites('user-123', 1, mockClient as any);

    expect(rangeCalls).toEqual([[20, 39]]);
  });

  test('nextPage is undefined when all items loaded', async () => {
    const mockClient = createMockClient({
      data: [{ product: { id: 'p1' } }, { product: { id: 'p2' } }],
      count: 2,
    });

    const result = await fetchAllFavorites('user-123', 0, mockClient as any);

    expect(result.nextPage).toBeUndefined();
  });

  test('nextPage is defined when more items exist', async () => {
    const mockClient = createMockClient({
      data: [{ product: { id: 'p1' } }],
      count: 25,
    });

    const result = await fetchAllFavorites('user-123', 0, mockClient as any);

    expect(result.nextPage).toBe(1);
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

    const result = await fetchAllFavorites('user-123', 0, mockClient as any);

    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('p1');
    expect(result.data[1].id).toBe('p2');
  });
});