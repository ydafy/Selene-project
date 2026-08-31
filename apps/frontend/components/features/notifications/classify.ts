import { Notification } from '@selene/types';

export type NotificationKind = 'dialog' | 'toast';

export function classify(
  n: Pick<Notification, 'type' | 'action_path'>,
): NotificationKind {
  if (n.type === 'error' || n.type === 'warning') return 'dialog';

  const path = n.action_path ?? '';
  if (
    path.startsWith('/orders') ||
    path.startsWith('/wallet') ||
    path.startsWith('/verify')
  ) {
    return 'dialog';
  }

  return 'toast';
}
