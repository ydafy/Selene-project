import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The push components have no render harness, so their wiring is pinned here.
const root = join(import.meta.dir, '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

test('the network listener registers only on the transition back online', () => {
  const source = read('components/features/notifications/PushRegistration.tsx');
  expect(source).toMatch(
    /const backOnline = createOnlineTransition\(\);\s*const unsubscribeNetwork = NetInfo\.addEventListener\(\(state\) => \{\s*if \(backOnline\(state\)\) void pushRegistrar\.register\(userId\);/,
  );
  expect(source).not.toContain('isNetworkReachable');
});

test('the tap handler is mounted inside SystemGuard, next to the navigator', () => {
  expect(read('app/_layout.tsx')).toMatch(
    /<SystemGuard>\s*<PushTapHandler \/>\s*\{STRIPE_KEY \?/,
  );
});

test('the push module is loaded at startup, so the foreground handler is set', () => {
  const source = read('core/push/pushTap.ts');
  expect(source).toMatch(
    /Notifications\.setNotificationHandler\(\{\s*handleNotification: async \(\) => FOREGROUND_PUSH_BEHAVIOR,\s*\}\);/,
  );
  expect(
    read('components/features/notifications/PushTapHandler.tsx'),
  ).toContain("from '../../../core/push/pushTap'");
});

test('a tap goes through the inbox press handler', () => {
  const source = read('components/features/notifications/PushTapHandler.tsx');
  expect(source).toContain('createNotificationPressHandler({');
  expect(source).toContain(
    'navigate: (path) => NotificationLinking.navigate(path)',
  );
  expect(source).toContain(
    'addNotificationResponseReceivedListener(\n      (response) => pushTapRouter.receive(response),',
  );
  expect(source).toMatch(
    /ready: navigatorReady && !loading,\s*press: userId \? press : null,/,
  );
});
