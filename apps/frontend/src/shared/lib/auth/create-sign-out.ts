import {
  runCleanupSteps,
  runSignOut,
  type SignOutResult,
  type SignOutScope,
} from './sign-out.logic';

/**
 * What the app root injects so `shared/` never imports a feature: the user-scoped
 * resets and the push hooks. `app/_layout.tsx` owns the list.
 */
export type SignOutWiring = {
  /** Everything tied to the signed-in user, run in order; one throwing does not stop the rest. */
  userDataResets: readonly (() => unknown)[];
  /** Runs before the Supabase sign-out (the RPC needs the session); never blocks it. */
  unregisterPush?: () => Promise<void>;
  /** Called once the sign-out ends, whatever its result. */
  signOutFinished?: () => void;
};

/** Runs the user-scoped resets; throws the first failure after running them all. */
export const clearUserData = (wiring: SignOutWiring): void =>
  runCleanupSteps([...wiring.userDataResets]);

/** Single sign-out path. Routine logout is this device only. */
export const createSignOut =
  ({
    supabaseSignOut,
    wiring,
  }: {
    supabaseSignOut: (scope: SignOutScope) => Promise<{ error: Error | null }>;
    wiring: SignOutWiring;
  }) =>
  (scope: SignOutScope = 'local'): Promise<SignOutResult> =>
    runSignOut({
      scope,
      signOut: supabaseSignOut,
      cleanup: () => clearUserData(wiring),
      unregisterPush: wiring.unregisterPush,
      signOutFinished: wiring.signOutFinished,
    });
