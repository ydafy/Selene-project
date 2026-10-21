import { describe, expect, it, mock } from 'bun:test';

const memory = new Map<string, string>();
const deviceStorage = {
  getItem: async (key: string) => memory.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: async (key: string) => {
    memory.delete(key);
  },
};
const appStateListeners: ((state: string) => void)[] = [];

mock.module('react-native-url-polyfill/auto', () => ({}));
mock.module('@react-native-async-storage/async-storage', () => ({
  default: deviceStorage,
}));
mock.module('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    currentState: 'active',
    addEventListener: (_type: string, listener: (state: string) => void) => {
      appStateListeners.push(listener);
      return { remove: () => undefined };
    },
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

describe('native supabase client', () => {
  it('stores the session in device storage and follows the app state', async () => {
    const { supabase } = await import('./supabase');
    const auth = supabase.auth as unknown as {
      storage: unknown;
      persistSession: boolean;
    };

    expect(auth.storage).toBe(deviceStorage);
    expect(auth.persistSession).toBe(true);
    expect(appStateListeners).toHaveLength(1);
  });
});
