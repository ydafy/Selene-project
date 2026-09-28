import type { Notification } from '@selene/types';
import { getVerifiedEventIdentity } from './notificationPresentation';

// Priority is an explicit catalogue consumer policy, never inferred from legacy copy or routes.
const priority: Record<NonNullable<ReturnType<typeof getVerifiedEventIdentity>>['kind'], Partial<Record<'buyer' | 'seller', number>>> = {
  'order.payment_confirmed': { buyer: 2, seller: 2 },
  'shipment.cancelled': { buyer: 3, seller: 3 },
  'dispute.opened': { buyer: 3, seller: 3 },
  'dispute.verdict': { buyer: 3, seller: 3 },
  'product.approved': { seller: 1 },
  'product.approved_with_note': { seller: 1 },
  'product.rejected': { seller: 2 },
  'return.seller_evidence_submitted': { buyer: 2 },
  'return.delivered': { buyer: 2, seller: 2 },
};

function rank(row: Notification): number {
  const identity = getVerifiedEventIdentity(row);
  return identity ? priority[identity.kind][identity.role] ?? 0 : 0;
}

export type LaunchCursor = Pick<Notification, 'created_at' | 'id'>;

/** Scan ordered owner pages without retaining the entire unread inbox. */
export async function scanLaunchDigest(
  ownerId: string,
  loadPage: (cursor: LaunchCursor | null) => Promise<Notification[]>,
  pageSize: number,
  cancelled: () => boolean = () => false,
): Promise<{ notice: Notification | null; hasMore: boolean } | null> {
  let cursor: LaunchCursor | null = null;
  let best: Notification | null = null;
  let count = 0;
  while (!cancelled()) {
    const rows = await loadPage(cursor);
    if (cancelled()) return null;
    for (const row of rows) {
      if (row.user_id !== ownerId || row.read === true || row.deleted_at !== null) continue;
      count++;
      if (!best || rank(row) > rank(best) || (rank(row) === rank(best) &&
        (row.created_at > best.created_at || (row.created_at === best.created_at && row.id > best.id)))) best = row;
    }
    if (rows.length < pageSize || (best && rank(best) === 3 && count > 1)) return { notice: best, hasMore: count > 1 };
    const last = rows[rows.length - 1];
    if (!last) return { notice: best, hasMore: count > 1 };
    if (cursor && (last.created_at > cursor.created_at ||
      (last.created_at === cursor.created_at && last.id >= cursor.id))) {
      throw new Error('Launch digest cursor did not advance');
    }
    cursor = { created_at: last.created_at, id: last.id };
  }
  return null;
}

/** Rank only verified catalogue identity within the supplied owner sample. */
export function selectLaunchDigest(rows: Notification[], ownerId: string): Notification | null {
  return rows
    .filter((row) => row.user_id === ownerId && row.read !== true && row.deleted_at === null)
    .sort((a, b) => rank(b) - rank(a) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
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
