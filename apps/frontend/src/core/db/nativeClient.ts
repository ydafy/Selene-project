import { createClient } from '@supabase/supabase-js';

import {
  bindAutoRefreshToAppState,
  createNativeAuthOptions,
  type AppStateSource,
  type AuthStorage,
} from './authSession';

export type NativeClientDeps = {
  storage: AuthStorage;
  appState: AppStateSource;
  platformOS: string;
};

/**
 * Builds the Supabase client with device session storage and, on native
 * platforms, a refresh ticker tied to the app state. Platform dependencies are
 * injected so the wiring can be tested without React Native.
 */
export const createNativeSupabaseClient = <Database>(
  url: string,
  anonKey: string,
  { storage, appState, platformOS }: NativeClientDeps,
) => {
  const client = createClient<Database>(url, anonKey, {
    auth: createNativeAuthOptions(storage),
  });

  // On web, auth-js follows page visibility itself.
  if (platformOS !== 'web') {
    bindAutoRefreshToAppState(client.auth, appState, client.auth.getSession());
  }

  return client;
};
