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
  /** Resolves `null` when no profile exists; rejects on a transient failure. */
  loadProfile: (userId: string) => Promise<P | null>;
  signOut: () => Promise<void>;
  clearCache: () => void;
  onDenied: (reason: AdminAccessDenial) => void;
}

export type AdminSessionOutcome<P> =
  | { status: 'allowed'; profile: P }
  | { status: 'denied'; reason: AdminAccessDenial }
  | { status: 'stale' };

export interface AdminSessionOptions<P> {
  /** Profile already allowed for this same user (token refresh, re-check). */
  allowedProfile?: P;
}

/**
 * Loads the profile of a session user and decides admin access. Denied access
 * clears cached data and signs the user out; stale results are discarded
 * without side effects. A transient load failure keeps an already-allowed
 * session (the server still rejects inactive admins) and denies a new one.
 */
export const resolveAdminSession = async <
  P extends { role: string | null; status: string | null },
>(
  userId: string,
  guard: LoadGuard,
  deps: AdminSessionDeps<P>,
  options: AdminSessionOptions<P> = {},
): Promise<AdminSessionOutcome<P>> => {
  const token = guard.begin();
  let profile: P | null;
  let loadFailed = false;
  try {
    profile = await deps.loadProfile(userId);
  } catch {
    profile = null;
    loadFailed = true;
  }
  if (!guard.isCurrent(token)) return { status: 'stale' };

  if (loadFailed && options.allowedProfile) {
    return { status: 'allowed', profile: options.allowedProfile };
  }

  const access = evaluateAdminAccess(profile);
  if (access.allowed && profile) return { status: 'allowed', profile };

  const reason: AdminAccessDenial = loadFailed
    ? 'unverified'
    : access.allowed
      ? 'missing_profile'
      : access.reason;
  guard.begin();
  deps.clearCache();
  deps.onDenied(reason);
  await deps.signOut();
  return { status: 'denied', reason };
};
