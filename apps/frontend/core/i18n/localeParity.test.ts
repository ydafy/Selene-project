import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join(import.meta.dir, 'locales');
const EN_DIR = join(LOCALES_DIR, 'en');
const ES_DIR = join(LOCALES_DIR, 'es');

/**
 * Recursively collects every dotted key path in a JSON locale object.
 * Leaf primitives (strings) and empty objects both emit their path.
 */
const collectKeys = (value: unknown, prefix = ''): string[] => {
  if (value === null || typeof value !== 'object') {
    return prefix ? [prefix] : [];
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return prefix ? [prefix] : [];
  }

  return entries.flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
};

const readKeys = (dir: string, file: string): string[] =>
  collectKeys(JSON.parse(readFileSync(join(dir, file), 'utf8'))).sort();

const listJson = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith('.json'));

// #78: files are read from disk so a new locale file is covered without editing this test.
describe('locale parity for every locale file', () => {
  it('has the same set of locale files in English and Spanish', () => {
    expect(listJson(ES_DIR).sort()).toEqual(listJson(EN_DIR).sort());
  });

  for (const file of listJson(EN_DIR)) {
    it(`keeps English and Spanish ${file} keys in sync`, () => {
      expect(existsSync(join(ES_DIR, file))).toBe(true);
      expect(readKeys(ES_DIR, file)).toEqual(readKeys(EN_DIR, file));
    });
  }
});
