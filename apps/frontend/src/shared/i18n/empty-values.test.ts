import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';

import enHome from './locales/en/home.json';
import esHome from './locales/es/home.json';

// source-text: the locale JSON files are the data under test, read as fixtures.
const LOCALES_DIR = join(import.meta.dir, 'locales');

// Empty values are allowed only here: search params of the home editorial cards,
// read as objects with returnObjects, where an empty value means "no filter".
const ALLOWED_EMPTY = /^home\.editorial\.cards\.\d+\.params\.[^.]+$/;

const collectEmptyLeaves = (value: unknown, path: string): string[] => {
  if (value === '') return [path];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => collectEmptyLeaves(child, `${path}.${key}`),
  );
};

const homeT = async (lng: 'en' | 'es') => {
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    fallbackLng: 'en',
    resources: { en: { home: enHome }, es: { home: esHome } },
    ns: ['home'],
    defaultNS: 'home',
    interpolation: { escapeValue: false },
  });
  return instance.t;
};

type EditorialCard = { params: Record<string, string> };

// i18next 27 sets returnEmptyString to false: t('key') on an empty value returns
// the key itself, so an empty string must never be read as a plain translation.
describe('empty locale values', () => {
  for (const lng of ['en', 'es']) {
    it(`has no empty value in ${lng} outside the editorial search params`, () => {
      const dir = join(LOCALES_DIR, lng);
      const empty = readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .flatMap((file) =>
          collectEmptyLeaves(
            JSON.parse(readFileSync(join(dir, file), 'utf8')),
            file.replace(/\.json$/, ''),
          ),
        );
      expect(empty.filter((path) => !ALLOWED_EMPTY.test(path))).toEqual([]);
    });
  }

  it('keeps the empty editorial search params empty when read with returnObjects', async () => {
    const t = await homeT('en');
    const cards = t('editorial.cards', {
      returnObjects: true,
    }) as EditorialCard[];
    expect(cards[2]?.params).toEqual({ query: '', category: '' });
  });

  it('reads the Spanish editorial search params as written', async () => {
    const t = await homeT('es');
    const cards = t('editorial.cards', {
      returnObjects: true,
    }) as EditorialCard[];
    expect(cards[2]?.params).toEqual({ query: 'DDR4', category: 'RAM' });
  });
});
