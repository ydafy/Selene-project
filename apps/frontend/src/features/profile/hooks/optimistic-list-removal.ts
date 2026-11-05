import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** Every cached entry the removal changed, with its data before the change. */
export type CachedListsSnapshot = [QueryKey, unknown][];

/**
 * Removes a row by id from every cached list under the given key prefixes
 * (e.g. ['my-listings', userId], ['products', filters]) and returns what it
 * changed, so restoreCachedLists can undo it. Non-array entries are left alone.
 */
export const removeProductFromCachedLists = (
  queryClient: QueryClient,
  prefixes: string[],
  id: string,
): CachedListsSnapshot => {
  const snapshot: CachedListsSnapshot = [];
  for (const prefix of prefixes) {
    for (const [key, data] of queryClient.getQueriesData({
      queryKey: [prefix],
    })) {
      if (!Array.isArray(data)) continue;
      snapshot.push([key, data]);
      queryClient.setQueryData(
        key,
        data.filter((row: { id?: unknown }) => row?.id !== id),
      );
    }
  }
  return snapshot;
};

/** Puts back every entry recorded by removeProductFromCachedLists. */
export const restoreCachedLists = (
  queryClient: QueryClient,
  snapshot: CachedListsSnapshot,
) => {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
};
