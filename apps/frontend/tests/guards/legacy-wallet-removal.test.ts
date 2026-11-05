import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC_ROOT = join(import.meta.dir, '..', '..', 'src');
// Every folder under src/, so moved code and locales stay covered.
const SCANNED_DIRS = ['.'];
const LEGACY_PATTERN = /wallet|withdraw/i;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const files = SCANNED_DIRS.flatMap((dir) => listFiles(join(SRC_ROOT, dir)));

describe('legacy wallet removal', () => {
  // A wrong root that still exists would scan nothing and pass silently.
  it('scans the app sources', () => {
    const scanned = files.map((path) =>
      relative(SRC_ROOT, path).split(sep).join('/'),
    );
    expect(scanned).toContain('features/auth/hooks/use-auth.ts');
  });

  it('keeps no wallet or withdraw file names in the app', () => {
    const offenders = files
      .map((path) => relative(SRC_ROOT, path).split(sep).join('/'))
      .filter((path) => LEGACY_PATTERN.test(path));
    expect(offenders).toEqual([]);
  });

  it('keeps no wallet or withdraw references in app sources or locales', () => {
    const offenders = files
      .filter((path) => LEGACY_PATTERN.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC_ROOT, path).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });
});
