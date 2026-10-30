import type { AccountStatus } from '@selene/types';

const CLOSED_USERNAME = /^deleted_[0-9a-f]{12}$/;

/**
 * fn_close_account bans the account (reason account_closed) and renames it to
 * deleted_ + 12 hex. admin_user_directory_view exposes neither the reason nor
 * deleted_at, so the closed marker is the banned status plus that username.
 */
export function isClosedAccount(user: {
  status: AccountStatus | null;
  username: string | null;
}): boolean {
  return user.status === 'banned' && CLOSED_USERNAME.test(user.username ?? '');
}
