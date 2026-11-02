export type SignOutScope = 'local' | 'global';

export type SignOutResult = { success: boolean; error: Error | null };

type SignOutDeps = {
  scope: SignOutScope;
  signOut: (scope: SignOutScope) => Promise<{ error: Error | null }>;
  cleanup: () => void;
  /** Runs before `signOut` (the RPC needs the session); never blocks it. */
  unregisterPush?: () => Promise<void>;
  /** A stalled network must not hold the sign-out; defaults to 4 s. */
  unregisterTimeoutMs?: number;
};

const UNREGISTER_TIMEOUT_MS = 4000;

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error('Unexpected sign-out error');

/** Runs every step even if one throws, then rethrows the first failure. */
export const runCleanupSteps = (steps: (() => unknown)[]): void => {
  let firstError: Error | null = null;
  for (const step of steps) {
    try {
      step();
    } catch (e) {
      firstError ??= toError(e);
    }
  }
  if (firstError) throw firstError;
};

/** User-scoped cleanup always runs, even when the sign-out call fails. */
export const runSignOut = async ({
  scope,
  signOut,
  cleanup,
  unregisterPush,
  unregisterTimeoutMs = UNREGISTER_TIMEOUT_MS,
}: SignOutDeps): Promise<SignOutResult> => {
  let error: Error | null = null;
  if (unregisterPush) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        unregisterPush(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, unregisterTimeoutMs);
        }),
      ]);
    } catch {
      // The sign-out result does not depend on the token.
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    ({ error } = await signOut(scope));
  } catch (e) {
    error = toError(e);
  }
  try {
    cleanup();
  } catch (e) {
    error ??= toError(e);
  }
  return { success: error === null, error };
};
