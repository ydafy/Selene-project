import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';


// The legacy digest no longer uses the obsolete classifier or dialog controls.

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

  test('paginates owner-scoped rows with optional typed metadata and never marks read', () => {
    const source = watcherSource();
    expect(source).toContain(".select('*')");
    expect(source).toContain(".eq('user_id', userId)");
    expect(source).toContain(".is('deleted_at', null)");
    expect(source).toContain("query.or('read.is.null,read.eq.false')");
    expect(source).toContain('and(read.is.null,or(${older})),and(read.eq.false,or(${older}))');
    expect(source).toContain('id.lt.${cursor.id}');
    expect(source).toContain('current.notice.title');
    expect(source).not.toContain('internal_note');
    expect(source).toMatch(/\.order\('created_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)\s*\.limit\(LAUNCH_LIMIT\)/);
    expect(source).toContain('scanLaunchDigest(userId');
    expect(source).toContain('currentOwner.current !== userId');
    expect(source).not.toContain('.range(');
    expect(source).toContain('gate.current.cancel(attempt)');
    expect(source).toContain('gate.current.complete(attempt)');
    expect(source).not.toContain('markAsRead');
  });

  test('uses a generic bounded-sample message and a focusable inbox button', () => {
    const source = watcherSource();
    expect(source).toContain("notifications:digestMore");
    expect(source).not.toContain("notifications:moreCount");
    expect(source).toMatch(/<Pressable\s+accessibilityRole="button"\s+accessible\s+focusable/);
    expect(source).toContain("onPress={() => navigate('/profile/notifications')}");
    for (const path of [EN_I18N_PATH, ES_I18N_PATH]) {
      expect(JSON.parse(readFileSync(path, 'utf8')).digestMore).toBeTypeOf('string');
    }
  });

  test('shows error toast on subscription catch', () => {
    expect(watcherSource()).toContain("type: 'error'");
  });

  test('retains one owner subscription and cache invalidation without queueing', () => {
    const source = watcherSource();
    expect(source).toContain('invalidateNotificationKeys(queryClient, userId)');
    expect(source).toContain('supabase.removeChannel(channel)');
    expect(source).not.toContain('setQueue');
  });

  test('does not call static Toast.hide()', () => {
    expect(watcherSource()).not.toContain('Toast.hide()');
  });
});

// ─── NotificationLinking contract ─────────────────────────────────────────

const LINKING_PATH = join(import.meta.dir, '..', '..', '..', '..', 'core', 'services', 'notification.ts');
const linkingSource = () => readFileSync(LINKING_PATH, 'utf8');

describe('NotificationLinking source contract', () => {
  test('removes unused pub/sub without changing validated navigation', () => {
    const source = linkingSource();
    expect(source).not.toContain('NotificationService');
    expect(source).toContain('export const NotificationLinking = {');
    expect(source).toContain("{ pattern: '/profile', params: [], redirectTo: '/profile/listings' }");
    expect(source).toContain("return '/profile/notifications';");
  });

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

  test('exposes a labeled dismiss button that opens confirmation before invoking dismiss', () => {
    const source = itemSource();
    // Structural source contract only: this does not exercise the rendered RN accessibility tree.
    expect(source).toMatch(/\{onDismiss && \(\s*<Pressable\s+onPress=\{\(\) => setShowConfirm\(true\)\}/);
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("accessibilityLabel={`${t('notifications:dismissLabel')}: ${notification.title}`}");
    expect(source).toContain('onConfirm={handleConfirmDismiss}');
    expect(source).toContain('await onDismiss?.(notification.id)');
    expect(source).not.toContain('onLongPress');
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
