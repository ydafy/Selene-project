/**
 * @file core/utils/notificationBadge.ts
 * @description Pure helper for formatting the unread-notification badge count.
 */

export function formatNotificationBadgeCount(count: number): string {
  return count >= 10 ? '9+' : String(count);
}
