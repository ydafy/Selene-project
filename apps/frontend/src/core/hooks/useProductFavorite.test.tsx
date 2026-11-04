import { expect, mock, test } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// mock.module leaks across files, so the mount test runs in its own process.
if (process.env.SELENE_FAVORITE_CHILD !== '1') {
  test('only a confirmed favorite insert offers the push pre-prompt', () => {
    const child = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.path],
      env: { ...process.env, SELENE_FAVORITE_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (child.exitCode !== 0)
      throw new Error(
        new TextDecoder().decode(child.stdout) +
          new TextDecoder().decode(child.stderr),
      );
    expect(child.exitCode).toBe(0);
  });
} else {
  const db = {
    isFavorite: false,
    insertError: null as unknown,
    writes: [] as string[],
  };
  const offerPushPermission = mock<(moment: string) => Promise<void>>(
    async () => {},
  );

  // Answers the three queries the hook makes: the favorite lookup, the
  // product check and the insert or delete.
  const from = (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: db.isFavorite ? { id: 'favorite-1' } : null,
        error: null,
      }),
      single: async () => ({ data: { id: 'product-1' }, error: null }),
      insert: async () => {
        db.writes.push(`insert:${table}`);
        return { error: db.insertError };
      },
      delete: () => {
        db.writes.push(`delete:${table}`);
        return query;
      },
      then: (resolve: (value: { error: null }) => unknown) =>
        resolve({ error: null }),
    };
    return query;
  };

  mock.module('react-native', () => ({
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
    },
  }));
  mock.module('../../shared/lib/supabase', () => ({ supabase: { from } }));
  mock.module('../../shared/lib/auth/auth-provider', () => ({
    useAuthContext: () => ({ session: { user: { id: 'user-1' } } }),
  }));
  mock.module('../push/pushPermission', () => ({ offerPushPermission }));

  const { act, render } = await import('@testing-library/react-native');
  const { useProductFavorite } = await import('./useProductFavorite');

  type Hook = ReturnType<typeof useProductFavorite>;
  let hook: Hook | null = null;
  const Harness = () => {
    hook = useProductFavorite('product-1');
    return null;
  };

  const mount = async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const view = await render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    for (let i = 0; i < 20 && hook?.isLoading; i++) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    return () => view.unmount();
  };

  const toggle = async () => {
    await act(async () => {
      await hook!.toggleFavoriteAsync().catch(() => {});
    });
  };

  const reset = (state: Partial<typeof db>) => {
    db.isFavorite = false;
    db.insertError = null;
    db.writes = [];
    Object.assign(db, state);
    offerPushPermission.mockClear();
    hook = null;
  };

  test('adding a favorite offers the favorite moment', async () => {
    reset({});
    const unmount = await mount();
    await toggle();
    expect(db.writes).toEqual(['insert:favorites']);
    expect(offerPushPermission.mock.calls).toEqual([['favorite']]);
    await unmount();
  });

  test('removing a favorite does not offer push', async () => {
    reset({ isFavorite: true });
    const unmount = await mount();
    expect(hook!.isFavorite).toBe(true);
    await toggle();
    expect(db.writes).toEqual(['delete:favorites']);
    expect(offerPushPermission).not.toHaveBeenCalled();
    await unmount();
  });

  test('a failed insert does not offer push', async () => {
    const error = console.error;
    console.error = () => {};
    try {
      reset({ insertError: new Error('insert failed') });
      const unmount = await mount();
      await toggle();
      expect(db.writes).toEqual(['insert:favorites']);
      expect(offerPushPermission).not.toHaveBeenCalled();
      await unmount();
    } finally {
      console.error = error;
    }
  });
}
