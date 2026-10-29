import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';

// #50: these error toasts used `common:errors.errorTitle`, which does not exist, so the raw key
// was shown as the title. Other screens with missing `common:` keys are tracked in their own issue.
const FRONTEND_DIR = join(import.meta.dir, '..', '..');
const SOURCES = [
  'app/profile/orders/report/[id].tsx',
  'app/profile/orders/return/[id].tsx',
  'components/features/product/hooks/useProductCart.ts',
  'core/hooks/useProductManagement.ts',
];

const lookup = (locale: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      locale,
    );

describe('common namespace key usage (#50)', () => {
  it('resolves every literal common: key of the order report, return, cart and listing toasts', () => {
    const missing: string[] = [];
    for (const file of SOURCES) {
      const source = readFileSync(join(FRONTEND_DIR, file), 'utf8');
      const matches = [...source.matchAll(/\bt\(\s*'common:([\w.]+)'/g)];
      // Each file shows at least the error title, so an empty scan means the pattern broke.
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        for (const [lang, locale] of [['en', enCommon], ['es', esCommon]] as const) {
          if (typeof lookup(locale, match[1]) !== 'string') missing.push(`${lang} common:${match[1]} (${file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
