import type { Notification } from '@selene/types';

/** Legacy rows have equal generic priority; newest wins, with ID as tie-breaker. */
export function selectLaunchDigest(rows: Notification[], ownerId: string): Notification | null {
  return rows
    .filter((row) => row.user_id === ownerId && row.read !== true && row.deleted_at === null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
}

/** An effect cleanup releases only its own pending attempt, never a settled launch. */
export function createLaunchDigestGate() {
  let pending: { owner: string } | null = null;
  let settled = false;
  return {
    begin: (owner: string) => {
      if (settled || pending) return null;
      pending = { owner };
      return pending;
    },
    cancel: (attempt: { owner: string }) => {
      if (pending === attempt) pending = null;
    },
    complete: (attempt: { owner: string }) => {
      if (pending !== attempt || settled) return false;
      pending = null;
      settled = true;
      return true;
    },
    reset: () => { pending = null; settled = false; },
  };
}
