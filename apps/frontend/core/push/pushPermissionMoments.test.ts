import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The push pre-prompt is offered at the three moments of L6 and nowhere else;
// the hooks and screens have no render harness, so the wiring is pinned here.
const root = join(import.meta.dir, '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

test('the checkout success screen offers the purchase moment', () => {
  expect(read('app/checkout/success.tsx')).toContain(
    "offerPushPermission('purchase')",
  );
});

test('only a confirmed favorite insert offers the favorite moment', () => {
  const source = read('core/hooks/useProductFavorite.ts');
  expect(source).toMatch(
    /onSuccess:\s*\(result\)\s*=>\s*\{\s*if \(result === 'added'\) void offerPushPermission\('favorite'\);/,
  );
  expect(source).toContain("return 'added'");
  expect(source).toContain("return 'removed'");
});

test('only a new listing, not an edit, offers the listing moment', () => {
  expect(read('core/hooks/usePublishProduct.ts')).toMatch(
    /if \(!isEditMode\) void offerPushPermission\('listing'\);/,
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
    'core/hooks/useProductFavorite.ts',
    'core/hooks/usePublishProduct.ts',
  ];
  const all = new Bun.Glob('{app,components,core}/**/*.{ts,tsx}');
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
