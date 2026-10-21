import { describe, expect, it } from 'bun:test';

import { createNativeSupabaseClient } from './nativeClient';
import type { AppStateSource, AuthStorage } from './authSession';

// Builds the real client with injected platform dependencies, so this test does
// not depend on the module registry (bun `mock.module` is process-wide and other
// files replace `db/supabase` with partial fakes).
const createDeps = (platformOS: string) => {
  const memory = new Map<string, string>();
  const storage: AuthStorage = {
    getItem: async (key) => memory.get(key) ?? null,
    setItem: async (key, value) => {
      memory.set(key, value);
    },
    removeItem: async (key) => {
      memory.delete(key);
    },
  };
  const listeners: ((state: string) => void)[] = [];
  const appState: AppStateSource = {
    currentState: 'background',
    addEventListener: (_type, listener) => {
      listeners.push(listener);
      return { remove: () => undefined };
    },
  };
  return { storage, appState, platformOS, listeners };
};

type AuthInternals = { storage: unknown; persistSession: boolean };

describe('createNativeSupabaseClient', () => {
  it('stores the session in the injected device storage', async () => {
    const deps = createDeps('ios');
    const client = createNativeSupabaseClient('http://127.0.0.1:54321', 'test-anon-key', deps);
    const auth = client.auth as unknown as AuthInternals;

    expect(auth.storage).toBe(deps.storage);
    expect(auth.persistSession).toBe(true);
    await client.auth.stopAutoRefresh();
  });

  it('follows the app state on native platforms', async () => {
    const deps = createDeps('android');
    const client = createNativeSupabaseClient('http://127.0.0.1:54321', 'test-anon-key', deps);

    expect(deps.listeners).toHaveLength(1);
    await client.auth.stopAutoRefresh();
  });

  it('leaves visibility handling to auth-js on web', async () => {
    const deps = createDeps('web');
    const client = createNativeSupabaseClient('http://127.0.0.1:54321', 'test-anon-key', deps);

    expect(deps.listeners).toHaveLength(0);
    await client.auth.stopAutoRefresh();
  });
});
