import { expect, test, describe } from 'bun:test';
import { formatNotificationBadgeCount } from './notificationBadge';

describe('formatNotificationBadgeCount', () => {
  test('returns exact string for counts below 10', () => {
    expect(formatNotificationBadgeCount(0)).toBe('0');
    expect(formatNotificationBadgeCount(3)).toBe('3');
    expect(formatNotificationBadgeCount(9)).toBe('9');
  });

  test('clips to 9+ for counts of 10 or more', () => {
    expect(formatNotificationBadgeCount(10)).toBe('9+');
    expect(formatNotificationBadgeCount(24)).toBe('9+');
    expect(formatNotificationBadgeCount(999)).toBe('9+');
  });
});
