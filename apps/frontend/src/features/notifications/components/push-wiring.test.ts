import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The push components have no render harness, so their wiring is pinned here.
const root = join(import.meta.dir, '..', '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

test('the network listener registers only on the transition back online', () => {
  const source = read(
    'features/notifications/components/push-registration.tsx',
  );
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
  const source = read('features/notifications/lib/push-tap.ts');
  expect(source).toMatch(
    /Notifications\.setNotificationHandler\(\{\s*handleNotification: async \(\) => FOREGROUND_PUSH_BEHAVIOR,\s*\}\);/,
  );
  expect(
    read('features/notifications/components/push-tap-handler.tsx'),
  ).toContain("from '../lib/push-tap'");
});

test('a tap goes through the inbox press handler', () => {
  const source = read('features/notifications/components/push-tap-handler.tsx');
  expect(source).toContain('createNotificationPressHandler({');
  expect(source).toContain(
    'navigate: (path) => NotificationLinking.navigate(path)',
  );
  expect(source).toMatch(
    /addNotificationResponseReceivedListener\(\s*\(response\) => pushTapRouter\.receive\(response\),/,
  );
  expect(source).toMatch(
    /ready: navigatorReady && !loading,\s*press: userId \? press : null,/,
  );
});

test('the registration does not listen for device token events', () => {
  // On Android every token request emits the device token event, so a
  // listener that registers again would loop (#213). Expo keeps the Expo push
  // token current on its own when the FCM token rotates.
  expect(
    read('features/notifications/components/push-registration.tsx'),
  ).not.toContain('addPushTokenListener');
});
