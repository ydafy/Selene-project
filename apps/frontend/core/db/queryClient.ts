import { QueryClient } from '@tanstack/react-query';

function isPermanentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const m = error.message;

  if (m.includes('permission denied') || m.includes('42501')) return true;
  if (m.includes('401') || m.includes('403') || m.includes('not authenticated')) return true;
  if (m.includes('404') || m.includes('not found')) return true;
  if (m.includes('422') || m.includes('validation')) return true;

  return false;
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  const m = error.message;
  return m.includes('Failed to fetch') || m.includes('Network request failed');
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isPermanentError(error)) return false;
        if (isNetworkError(error)) return failureCount < 3;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      networkMode: 'online',
    },
    mutations: {
      onError: (error) => {
        if (__DEV__) {
          console.error('[Mutation Error]', error instanceof Error ? error.message : error);
        }
      },
    },
  },
});
