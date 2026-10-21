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

const logRefreshFailure = (action: string, error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`[AUTH] ${action} failed:`, message);
};

/**
 * `ready` should resolve once auth-js finished its own initialization: outside
 * a browser it starts its ticker there, which could undo a background stop.
 * The then-current AppState is applied again at that point.
 */
export const bindAutoRefreshToAppState = (
  auth: AutoRefreshControl,
  appState: AppStateSource,
  ready?: Promise<unknown>,
): (() => void) => {
  let bound = true;

  const apply = (state: string) => {
    if (state === 'active') {
      auth.startAutoRefresh().catch((e) => logRefreshFailure('startAutoRefresh', e));
    } else {
      auth.stopAutoRefresh().catch((e) => logRefreshFailure('stopAutoRefresh', e));
    }
  };

  apply(appState.currentState);
  const subscription = appState.addEventListener('change', apply);
  ready
    ?.catch(() => undefined)
    .then(() => {
      if (bound) apply(appState.currentState);
    });

  return () => {
    bound = false;
    subscription.remove();
  };
};
