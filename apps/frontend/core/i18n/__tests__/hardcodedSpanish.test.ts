import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * BL20: tab titles and label-generated copy used to be Spanish literals, so
 * English users saw Spanish. They must come from both locale files.
 */

const APP_DIR = join(import.meta.dir, '..', '..', '..');
const LOCALES_DIR = join(import.meta.dir, '..', 'locales');

const readSource = (relativePath: string) =>
  readFileSync(join(APP_DIR, relativePath), 'utf8');

const lookup = (lang: 'es' | 'en', namespace: string, key: string): unknown => {
  const locale = JSON.parse(
    readFileSync(join(LOCALES_DIR, lang, `${namespace}.json`), 'utf8'),
  );
  return key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      locale,
    );
};

const REQUIRED_KEYS: Array<[string, string, string]> = [
  ['common', 'tabs.home', 'Home'],
  ['common', 'tabs.search', 'Search'],
  ['common', 'tabs.sell', 'Sell'],
  ['common', 'tabs.cart', 'Cart'],
  ['common', 'tabs.profile', 'Profile'],
  ['orders', 'prepare.alreadyGeneratedTitle', 'Label already generated'],
  [
    'orders',
    'prepare.alreadyGeneratedDesc',
    'This shipment already has its shipping label.',
  ],
];

describe('BL20 hardcoded Spanish', () => {
  test.each(REQUIRED_KEYS)(
    '%s:%s exists in both locales',
    (namespace, key, english) => {
      expect(lookup('en', namespace, key)).toBe(english);
      const spanish = lookup('es', namespace, key);
      expect(typeof spanish).toBe('string');
      expect((spanish as string).length).toBeGreaterThan(0);
    },
  );

  test('tab titles are translated, not literals', () => {
    const source = readSource('app/(tabs)/_layout.tsx');
    expect(/title:\s*['"`]/.test(source)).toBe(false);
    for (const tab of ['home', 'search', 'sell', 'cart', 'profile']) {
      expect(source).toContain(`t('tabs.${tab}')`);
    }
  });

  test.each([
    'app/checkout/success.tsx',
    'app/profile/orders/prepare/[id].tsx',
  ])('%s passes no Spanish defaultValue to t()', (file) => {
    expect(readSource(file).includes('defaultValue')).toBe(false);
  });
});
