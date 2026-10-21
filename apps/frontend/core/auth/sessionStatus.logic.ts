import type { AccountStatus } from '@selene/types';

export type StatusState = {
  userId: string | null;
  status: AccountStatus;
  reason: string | null;
};

export type StatusLoadResult =
  | { ok: true; status: AccountStatus | null; reason: string | null }
  | { ok: false };

export const INITIAL_STATUS_STATE: StatusState = {
  userId: null,
  status: 'active',
  reason: null,
};

/**
 * Applies a status response only if it still belongs to the current session
 * user. Late responses for a previous user (or after sign-out) are discarded.
 * A failed load never carries another user's status, and keeps the last known
 * status of the same user so a network error cannot downgrade a ban.
 */
export const applyStatusLoad = (
  state: StatusState,
  requestedUserId: string,
  currentUserId: string | null,
  result: StatusLoadResult,
): StatusState => {
  if (requestedUserId !== currentUserId) return state;

  if (result.ok) {
    return {
      userId: requestedUserId,
      status: result.status ?? 'active',
      reason: result.reason ?? null,
    };
  }

  if (state.userId === requestedUserId) return state;
  return { userId: requestedUserId, status: 'active', reason: null };
};

/** Drops any status that does not belong to the given session user. */
export const syncStatusOwner = (
  state: StatusState,
  userId: string | null,
): StatusState => (state.userId === userId ? state : INITIAL_STATUS_STATE);

export const shouldReloadStatusOnResume = (
  appState: string,
  userId: string | null,
): boolean => appState === 'active' && userId !== null;
