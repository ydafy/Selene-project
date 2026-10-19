import type { AccountStatus } from '@selene/types';

export type AccountStatusAction = 'suspend' | 'reactivate' | 'ban';

export const ACCOUNT_STATUS_ACTION_TARGET: Record<AccountStatusAction, AccountStatus> = {
  suspend: 'suspended',
  reactivate: 'active',
  ban: 'banned',
};

/**
 * Mirrors the server lifecycle in fn_admin_update_user_status: banned is final,
 * reactivation only lifts a suspension, and admins cannot change their own status.
 * A missing status is treated as active, as on the server.
 */
export function getAccountStatusActions(
  status: AccountStatus | null,
  isSelf: boolean,
): AccountStatusAction[] {
  if (isSelf) return [];
  switch (status ?? 'active') {
    case 'active':
      return ['suspend', 'ban'];
    case 'suspended':
      return ['reactivate', 'ban'];
    case 'banned':
      return [];
  }
}
