import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, type NotificationKind } from '../classify';

// ─── classify() table ─────────────────────────────────────────────────────

describe('classify', () => {
  const dialog = (type: string, action_path: string | null): NotificationKind =>
    classify({ type, action_path } as Parameters<typeof classify>[0]);

  test('error type always produces dialog', () => {
    expect(dialog('error', '/product/abc')).toBe('dialog');
    expect(dialog('error', null)).toBe('dialog');
  });

  test('warning type always produces dialog', () => {
    expect(dialog('warning', '/profile/wallet')).toBe('dialog');
    expect(dialog('warning', '')).toBe('dialog');
  });

  test('/orders prefix produces dialog', () => {
    expect(dialog('info', '/orders/123')).toBe('dialog');
  });

  test('/wallet prefix produces dialog', () => {
    expect(dialog('info', '/wallet')).toBe('dialog');
  });

  test('/verify prefix produces dialog', () => {
    expect(dialog('info', '/verify/abc')).toBe('dialog');
  });

  test('generic info notification produces toast', () => {
    expect(dialog('info', '/product/abc')).toBe('toast');
  });

  test('success notification produces toast', () => {
    expect(dialog('success', '/profile/favorites')).toBe('toast');
  });

  test('null action_path falls back to toast when type is not error/warning', () => {
    expect(dialog('info', null)).toBe('toast');
  });
});

// ─── Source-grep contracts ────────────────────────────────────────────────

const WATCHER_PATH = join(import.meta.dir, '..', 'NotificationWatcher.tsx');
const watcherSource = () => readFileSync(WATCHER_PATH, 'utf8');

describe('NotificationWatcher source contracts', () => {
  test('does not classify by title string matching', () => {
    expect(watcherSource()).not.toContain('title.includes(');
  });

  test('does not use isInitialLoadDone ref', () => {
    expect(watcherSource()).not.toContain('isInitialLoadDone');
  });

  test('does not perform initial fetchUnread effect', () => {
    expect(watcherSource()).not.toContain('fetchUnread');
  });

  test('uses localized moreCount key', () => {
    expect(watcherSource()).toContain("notifications:moreCount");
    expect(watcherSource()).not.toContain('mensajes más');
  });

  test('shows error toast on subscription catch', () => {
    expect(watcherSource()).toContain("type: 'error'");
  });

  test('uses visibilityTime for toast lifecycle', () => {
    expect(watcherSource()).toContain('visibilityTime');
  });

  test('does not call static Toast.hide()', () => {
    expect(watcherSource()).not.toContain('Toast.hide()');
  });
});

// ─── NotificationLinking contract ─────────────────────────────────────────

const LINKING_PATH = join(import.meta.dir, '..', '..', '..', '..', 'core', 'services', 'notification.ts');
const linkingSource = () => readFileSync(LINKING_PATH, 'utf8');

describe('NotificationLinking source contract', () => {
  test('navigate awaits router.push', () => {
    expect(linkingSource()).toContain('await router.push');
  });

  test('navigate wraps router.push in try/catch with fallback', () => {
    expect(linkingSource()).toContain('try {');
    expect(linkingSource()).toContain("router.push('/profile/notifications')");
  });
});

// ─── ToastConfig warning contract ─────────────────────────────────────────

const TOAST_CONFIG_PATH = join(import.meta.dir, '..', '..', '..', 'config', 'ToastConfig.tsx');
const toastConfigSource = () => readFileSync(TOAST_CONFIG_PATH, 'utf8');

describe('ToastConfig warning type', () => {
  test('defines warning toast entry', () => {
    expect(toastConfigSource()).toContain('warning:');
  });

  test('warning toast uses orange accent color', () => {
    expect(toastConfigSource()).toContain('#f59e0b');
  });
});

// ─── i18n shape contract ──────────────────────────────────────────────────

const EN_I18N_PATH = join(import.meta.dir, '..', '..', '..', '..', 'core', 'i18n', 'locales', 'en', 'notifications.json');
const ES_I18N_PATH = join(import.meta.dir, '..', '..', '..', '..', 'core', 'i18n', 'locales', 'es', 'notifications.json');

describe('notifications i18n shape', () => {
  test('en notifications.json is flat', () => {
    const json = JSON.parse(readFileSync(EN_I18N_PATH, 'utf8'));
    expect(json.notifications).toBeUndefined();
  });

  test('required keys exist in en', () => {
    const json = JSON.parse(readFileSync(EN_I18N_PATH, 'utf8'));
    expect(json.dismissLabel).toBeTypeOf('string');
    expect(json.clearAllLabel).toBeTypeOf('string');
    expect(json.clearAllConfirm).toBeTypeOf('string');
    expect(json.moreCount).toBeTypeOf('string');
    expect(json.openLabel).toBeTypeOf('string');
  });

  test('required keys exist in es', () => {
    const json = JSON.parse(readFileSync(ES_I18N_PATH, 'utf8'));
    expect(json.dismissLabel).toBeTypeOf('string');
    expect(json.clearAllLabel).toBeTypeOf('string');
    expect(json.clearAllConfirm).toBeTypeOf('string');
    expect(json.moreCount).toBeTypeOf('string');
    expect(json.openLabel).toBeTypeOf('string');
  });
});

// ─── NotificationItem source contracts ────────────────────────────────────

const ITEM_PATH = join(import.meta.dir, '..', 'NotificationItem.tsx');
const itemSource = () => readFileSync(ITEM_PATH, 'utf8');

describe('NotificationItem source contracts', () => {
  test('uses accessibilityLabel for dismiss', () => {
    expect(itemSource()).toContain('accessibilityLabel');
    expect(itemSource()).toContain('dismissLabel');
  });

  test('uses onLongPress for dismiss trigger', () => {
    expect(itemSource()).toContain('onLongPress');
  });

  test('shows ConfirmDialog before dismiss', () => {
    expect(itemSource()).toContain('ConfirmDialog');
    expect(itemSource()).toContain('showConfirm');
  });
});

// ─── NotificationsScreen source contracts ─────────────────────────────────

const SCREEN_PATH = join(import.meta.dir, '..', '..', '..', '..', 'app', 'profile', 'notifications.tsx');
const screenSource = () => readFileSync(SCREEN_PATH, 'utf8');

describe('NotificationsScreen source contracts', () => {
  test('clear-all uses ConfirmDialog confirmation', () => {
    expect(screenSource()).toContain('ConfirmDialog');
    expect(screenSource()).toContain('showClearAll');
    expect(screenSource()).toContain('clearAllConfirm');
  });

  test('clear-all calls dismissAll after confirmation', () => {
    expect(screenSource()).toContain('dismissAll');
  });

  test('cancel clear-all closes dialog without mutation', () => {
    expect(screenSource()).toContain('setShowClearAll(false)');
  });
});

// ─── Bell badge source contracts ──────────────────────────────────────────

const HOME_PATH = join(import.meta.dir, '..', '..', '..', '..', 'app', '(tabs)', 'index.tsx');
const homeSource = () => readFileSync(HOME_PATH, 'utf8');

describe('Home bell badge source contracts', () => {
  test('bell icon has accessibilityLabel', () => {
    expect(homeSource()).toContain('accessibilityLabel');
    expect(homeSource()).toContain('openLabel');
  });

  test('uses formatNotificationBadgeCount for clipped display', () => {
    expect(homeSource()).toContain('formatNotificationBadgeCount');
  });
});
