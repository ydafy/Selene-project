import { describe, expect, it } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

import { resetUserQueries } from './userQueries.logic';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const observe = (client: QueryClient, queryKey: string[], value: unknown) => {
  const options = {
    queryKey,
    queryFn: async () => {
      await sleep(20);
      return value;
    },
    staleTime: 60_000,
  };
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, options, unsubscribe };
};

describe('resetUserQueries', () => {
  it('keeps the system configuration that gates the whole app', async () => {
    const client = new QueryClient();
    const config = observe(client, ['system-settings'], { id: 1 });
    await sleep(50);

    resetUserQueries(client);
    // The auth context changed, so SystemGuard re-renders.
    config.observer.setOptions(config.options);

    const result = config.observer.getCurrentResult();
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ id: 1 });
    config.unsubscribe();
  });

  it('drops the previous user data from the cache', async () => {
    const client = new QueryClient();
    client.setQueryData(['my-purchases', 'user-a'], [{ id: 'order-1' }]);

    resetUserQueries(client);

    expect(client.getQueryData(['my-purchases', 'user-a'])).toBeUndefined();
  });

  it('never leaves a mounted screen stuck when cleanup runs twice during a refetch', async () => {
    const client = new QueryClient();
    const home = observe(client, ['products', 'home'], ['listing']);
    await sleep(50);

    // SIGNED_OUT listener cleanup, the screen refetches, then signOutUser cleans again.
    resetUserQueries(client);
    home.observer.setOptions(home.options);
    await sleep(5);
    resetUserQueries(client);
    // No further re-render: nothing else changes after sign-out resolves.
    await sleep(100);

    const result = home.observer.getCurrentResult();
    expect(result.status).toBe('success');
    expect(result.fetchStatus).toBe('idle');
    expect(result.data).toEqual(['listing']);
    home.unsubscribe();
  });
});
