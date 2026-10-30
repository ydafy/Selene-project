import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';

// #50, #72: a `t('common:...')` call whose key is missing shows the raw key to the user.
// The scan matches literal calls only, `t('common:a.b')` or `t("common:a.b")`; dynamic keys
// (template strings, variables) are out of scope.
const FRONTEND_DIR = join(import.meta.dir, '..', '..');
const SKIPPED_DIRS = new Set(['node_modules', '__tests__', '.expo', 'dist', 'build']);
const COMMON_KEY_CALL = /\bt\(\s*(['"])common:([\w.]+)\1/g;

const listSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : listSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

const lookup = (locale: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      locale,
    );

// Plural keys such as `units.item_count` are stored as `item_count_one` / `item_count_other`.
const resolves = (locale: unknown, key: string): boolean =>
  typeof lookup(locale, key) === 'string' || typeof lookup(locale, `${key}_other`) === 'string';

describe('common namespace key usage', () => {
  it('resolves every literal common: key in English and Spanish', () => {
    const missing: string[] = [];
    let scanned = 0;
    for (const path of listSources(FRONTEND_DIR)) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(COMMON_KEY_CALL)) {
        scanned += 1;
        for (const [lang, locale] of [['en', enCommon], ['es', esCommon]] as const) {
          if (!resolves(locale, match[2])) {
            missing.push(`${lang} common:${match[2]} (${path.slice(FRONTEND_DIR.length + 1)})`);
          }
        }
      }
    }
    // An empty scan means the pattern or the directory walk broke.
    expect(scanned).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
