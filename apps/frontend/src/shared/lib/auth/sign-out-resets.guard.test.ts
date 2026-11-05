import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Sign-out must leave nothing of the previous user on a shared device (L37). The reset
// list lives in `app/_layout.tsx`, so a store added later without an entry would keep
// its data in AsyncStorage; this test fails until the list covers it.
const SRC = join(import.meta.dir, '..', '..', '..');
const layoutSource = readFileSync(join(SRC, 'app', '_layout.tsx'), 'utf8');

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const sourceFiles = (dir: string) =>
  [...new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: join(SRC, dir) })]
    .map((path) => join(dir, path))
    .filter((path) => !isTest(path));

/** Persisted stores that sign-out deliberately keeps. */
const KEPT_ON_SIGN_OUT: Record<string, string> = {
  useExperienceStore:
    'device preferences (onboarding and tour flags), not tied to the user',
};

const persistedStores = () =>
  sourceFiles('.')
    .map((path) => ({ path, source: readFileSync(join(SRC, path), 'utf8') }))
    .filter(({ source }) => /\bpersist\(/.test(source))
    .map(({ path, source }) => ({
      path: path.replaceAll('\\', '/'),
      name: /export const (use\w+Store)\b/.exec(source)?.[1] ?? null,
    }));

describe('sign-out reset list in app/_layout.tsx', () => {
  it('finds the persisted stores it is meant to guard', () => {
    const names = persistedStores().map((store) => store.name);
    expect(names).toContain('useCartStore');
    expect(names.every((name) => name !== null)).toBe(true);
  });

  it('resets every persisted store and clears its AsyncStorage key', () => {
    const missing: string[] = [];
    for (const { path, name } of persistedStores()) {
      if (!name || name in KEPT_ON_SIGN_OUT) continue;
      if (!layoutSource.includes(`${name}.getState()`)) {
        missing.push(`${name} (${path}): not reset in _layout`);
      }
      if (!layoutSource.includes(`${name}.persist.clearStorage()`)) {
        missing.push(`${name} (${path}): persist.clearStorage() not called`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps only stores that exist in the allow-list', () => {
    const names = persistedStores().map((store) => store.name);
    for (const name of Object.keys(KEPT_ON_SIGN_OUT)) {
      expect(names).toContain(name);
    }
  });
});

describe('shared/ sign-out boundary', () => {
  it('never imports features/ or core/auth/signOut', () => {
    const offenders: string[] = [];
    const importSpecifier =
      /(?:from|import\(|require\(|mock\.module\()\s*['"]([^'"]+)['"]/g;
    for (const path of sourceFiles('shared').concat(
      [
        ...new Bun.Glob('**/*.test.{ts,tsx}').scanSync({
          cwd: join(SRC, 'shared'),
        }),
      ].map((p) => join('shared', p)),
    )) {
      if (path.endsWith('sign-out-resets.guard.test.ts')) continue;
      const source = readFileSync(join(SRC, path), 'utf8');
      for (const [, specifier] of source.matchAll(importSpecifier)) {
        if (
          /(^|\/)features\//.test(specifier) ||
          /core\/auth\/signOut/.test(specifier)
        ) {
          offenders.push(`${path}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
