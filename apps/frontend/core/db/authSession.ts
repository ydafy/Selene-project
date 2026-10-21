/**
 * Native session lifecycle for the Supabase Auth client.
 *
 * React Native has no `localStorage`, so without an explicit storage adapter
 * auth-js keeps the session in memory and loses it on every cold start.
 * Outside a browser auth-js also runs its refresh ticker permanently, so the
 * app pauses it in the background and resumes it in the foreground.
 */

export type AuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type AutoRefreshControl = {
  startAutoRefresh: () => Promise<void>;
  stopAutoRefresh: () => Promise<void>;
};

export type AppStateSource = {
  currentState: string;
  addEventListener: (
    type: 'change',
    listener: (state: string) => void,
  ) => { remove: () => void };
};

export const createNativeAuthOptions = (storage: AuthStorage) => ({
  storage,
  persistSession: true,
  autoRefreshToken: true,
  // Native sign-in never returns through a browser URL.
  detectSessionInUrl: false,
});

export const bindAutoRefreshToAppState = (
  auth: AutoRefreshControl,
  appState: AppStateSource,
): (() => void) => {
  const apply = (state: string) => {
    if (state === 'active') {
      void auth.startAutoRefresh();
    } else {
      void auth.stopAutoRefresh();
    }
  };

  apply(appState.currentState);
  const subscription = appState.addEventListener('change', apply);
  return () => subscription.remove();
};
