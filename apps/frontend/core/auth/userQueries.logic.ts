import type { Query, QueryClient } from '@tanstack/react-query';

/** App-wide configuration, not user data; SystemGuard blanks the app without it. */
const DEVICE_SCOPED_QUERY_KEYS = new Set<unknown>(['system-settings']);

const isUserScoped = (query: Query) =>
  !DEVICE_SCOPED_QUERY_KEYS.has(query.queryKey[0]);

/**
 * Drops the previous user's cached data on sign-out.
 *
 * Resets instead of `clear()`: clearing destroys queries that mounted screens
 * still observe, and a second cleanup during their refetch cancels it silently,
 * leaving those screens loading forever. Reset keeps the observers attached and
 * refetches what is on screen.
 */
export const resetUserQueries = (client: QueryClient): void => {
  void client
    .resetQueries({ predicate: isUserScoped })
    .catch(() => undefined);
};
