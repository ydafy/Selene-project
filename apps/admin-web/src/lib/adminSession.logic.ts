import { evaluateAdminAccess, type AdminAccessDenial } from './adminAccess';

export interface LoadToken {
  seq: number;
}

/**
 * Tracks the latest profile load. Beginning a new load (another user, or
 * `null` on sign-out) invalidates every earlier one, so a late response for a
 * previous user can never be applied.
 */
export const createLoadGuard = () => {
  let latest = 0;
  return {
    begin: (): LoadToken => ({ seq: ++latest }),
    isCurrent: (token: LoadToken): boolean => token.seq === latest,
  };
};

export type LoadGuard = ReturnType<typeof createLoadGuard>;

export interface AdminSessionDeps<
  P extends { role: string | null; status: string | null },
> {
  loadProfile: (userId: string) => Promise<P | null>;
  signOut: () => Promise<void>;
  clearCache: () => void;
  onDenied: (reason: AdminAccessDenial) => void;
}

export type AdminSessionOutcome<P> =
  | { status: 'allowed'; profile: P }
  | { status: 'denied'; reason: AdminAccessDenial }
  | { status: 'stale' };

/**
 * Loads the profile of a session user and decides admin access. Denied access
 * clears cached data and signs the user out; stale results are discarded
 * without side effects.
 */
export const resolveAdminSession = async <
  P extends { role: string | null; status: string | null },
>(
  userId: string,
  guard: LoadGuard,
  deps: AdminSessionDeps<P>,
): Promise<AdminSessionOutcome<P>> => {
  const token = guard.begin();
  const profile = await deps.loadProfile(userId);
  if (!guard.isCurrent(token)) return { status: 'stale' };

  const access = evaluateAdminAccess(profile);
  if (access.allowed && profile) return { status: 'allowed', profile };

  const reason = access.allowed ? 'missing_profile' : access.reason;
  guard.begin();
  deps.clearCache();
  deps.onDenied(reason);
  await deps.signOut();
  return { status: 'denied', reason };
};
