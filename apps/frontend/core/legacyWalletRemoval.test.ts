import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FRONTEND_ROOT = join(import.meta.dir, '..');
const SCANNED_DIRS = ['app', 'components', 'core'];
const SELF = join('core', 'legacyWalletRemoval.test.ts');
const LEGACY_PATTERN = /wallet|withdraw/i;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const files = SCANNED_DIRS.flatMap((dir) => listFiles(join(FRONTEND_ROOT, dir))).filter(
  (path) => relative(FRONTEND_ROOT, path) !== SELF,
);

describe('legacy wallet removal', () => {
  it('keeps no wallet or withdraw file names in the app', () => {
    const offenders = files
      .map((path) => relative(FRONTEND_ROOT, path).split(sep).join('/'))
      .filter((path) => LEGACY_PATTERN.test(path));
    expect(offenders).toEqual([]);
  });

  it('keeps no wallet or withdraw references in app sources or locales', () => {
    const offenders = files
      .filter((path) => LEGACY_PATTERN.test(readFileSync(path, 'utf8')))
      .map((path) => relative(FRONTEND_ROOT, path).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });
});
