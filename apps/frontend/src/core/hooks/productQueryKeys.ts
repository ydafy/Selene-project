import type { QueryClient } from '@tanstack/react-query';
import {
  resolveProductStatuses,
  type UseProductsOptions,
} from './useProducts.helpers';

export const PRODUCTS_KEY_PREFIX = 'products';

/**
 * Key of a product list. Only the options that change the fetched rows are
 * part of it, so `enabled` never splits one list into two cache entries.
 * The first element stays `'products'` so prefix invalidation keeps working.
 */
export const productsListKey = (options?: UseProductsOptions) =>
  [
    PRODUCTS_KEY_PREFIX,
    {
      sellerId: options?.sellerId ?? null,
      limit: options?.limit ?? null,
      verifiedOnly: options?.verifiedOnly ?? false,
      statuses: [...resolveProductStatuses(options)].sort(),
    },
  ] as const;

const hasId = (value: unknown, id: string): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { id?: unknown }).id === id;

/** Rows of a cached entry: a plain list or an infinite query's pages. */
const rowsOf = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  const pages = (data as { pages?: unknown } | null | undefined)?.pages;
  return Array.isArray(pages) ? pages.filter(Array.isArray).flat() : [];
};

/** Finds a product by id in any list cached under the `'products'` prefix. */
export const findCachedProduct = <T = { id: string }>(
  queryClient: QueryClient,
  id: string,
): T | undefined => {
  for (const [, data] of queryClient.getQueriesData({
    queryKey: [PRODUCTS_KEY_PREFIX],
  })) {
    const found = rowsOf(data).find((row) => hasId(row, id));
    if (found) return found as T;
  }
  return undefined;
};
