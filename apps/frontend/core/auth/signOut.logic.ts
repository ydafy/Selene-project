export type SignOutScope = 'local' | 'global';

export type SignOutResult = { success: boolean; error: Error | null };

type SignOutDeps = {
  scope: SignOutScope;
  signOut: (scope: SignOutScope) => Promise<{ error: Error | null }>;
  cleanup: () => void;
};

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
}: SignOutDeps): Promise<SignOutResult> => {
  let error: Error | null = null;
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
