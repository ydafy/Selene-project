import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The push pre-prompt is offered at the three moments of L6 and nowhere else;
// the screens have no render harness, so their wiring is pinned here. The
// favorite moment runs in features/product/hooks/use-product-favorite.test.tsx.
const root = join(import.meta.dir, '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

test('the checkout success screen offers the purchase moment', () => {
  expect(read('app/checkout/success.tsx')).toContain(
    "offerPushPermission('purchase')",
  );
});

test('the listing moment is offered after a verification is sent, once its success dialog closes', () => {
  expect(read('app/verify/[id].tsx')).toMatch(
    /onConfirm: \(\) => \{\s*closeDialog\(\);\s*router\.replace\('\/\(tabs\)\/profile'\);\s*(?:\/\/[^\n]*\s*)?void offerPushPermission\('listing'\);/,
  );
});

test('creating or editing a listing does not offer push', () => {
  expect(read('features/sell/hooks/use-publish-product.ts')).not.toContain(
    'offerPushPermission',
  );
});

test('the prompt host is mounted next to the push registration', () => {
  expect(read('app/_layout.tsx')).toMatch(
    /<PushRegistration \/>\s*<PushPermissionPrompt \/>/,
  );
});

test('no other file offers the pre-prompt', () => {
  const callers = [
    'app/checkout/success.tsx',
    'features/product/hooks/use-product-favorite.ts',
    'app/verify/[id].tsx',
  ];
  const all = new Bun.Glob('**/*.{ts,tsx}');
  const offenders = [...all.scanSync(root)]
    .map((file) => file.replaceAll('\\', '/'))
    .filter(
      (file) =>
        !callers.includes(file) &&
        !file.startsWith('core/push/') &&
        read(file).includes('offerPushPermission('),
    );
  expect(offenders).toEqual([]);
});

test('settings shows the notifications section between security and privacy', () => {
  expect(read('app/profile/settings.tsx')).toMatch(
    /<SecuritySection \/>\s*<\/SettingsSection>\s*<SettingsSection title=\{t\('sections\.notifications'\)\}>\s*<NotificationsSection \/>\s*<\/SettingsSection>\s*<SettingsSection title=\{t\('sections\.privacy'\)\}>/,
  );
});

test('the prompt host closes through closePushPermission, which frees the next offer', () => {
  const host = read(
    'components/features/notifications/PushPermissionPrompt.tsx',
  );
  expect(host).toContain('const close = closePushPermission;');
  expect(host).toMatch(/const accept = \(\) => \{\s*close\(\);/);
  expect(host).toContain('onCancel={close}');
  expect(read('core/push/pushPermission.ts')).toMatch(
    /export const closePushPermission = \(\): void => \{\s*usePushPromptStore\.setState\(\{ moment: null \}\);\s*pushPermissionPrompt\.dismiss\(\);/,
  );
});
