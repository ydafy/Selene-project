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

/** A Zustand `persist(` call, with or without a type argument (`persist<S>(`). */
const PERSIST_CALL = /\bpersist\s*(?:<[^>]*>)?\s*\(/;

/** The `SIGN_OUT_WIRING` object only, without comments, so a mention elsewhere does not count. */
const wiringBlock = (source: string): string => {
  const start = source.indexOf('const SIGN_OUT_WIRING');
  if (start === -1) return '';
  const end = source.indexOf('\n};', start);
  return source
    .slice(start, end === -1 ? undefined : end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
};

const missingResets = (
  wiring: string,
  stores: { path: string; name: string | null }[],
): string[] => {
  const missing: string[] = [];
  for (const { path, name } of stores) {
    if (!name || name in KEPT_ON_SIGN_OUT) continue;
    if (!wiring.includes(`${name}.getState()`)) {
      missing.push(`${name} (${path}): not reset in _layout`);
    }
    if (!wiring.includes(`${name}.persist.clearStorage()`)) {
      missing.push(`${name} (${path}): persist.clearStorage() not called`);
    }
  }
  return missing;
};

const persistedStores = () =>
  sourceFiles('.')
    .map((path) => ({ path, source: readFileSync(join(SRC, path), 'utf8') }))
    .filter(({ source }) => PERSIST_CALL.test(source))
    .map(({ path, source }) => ({
      path: path.replaceAll('\\', '/'),
      name: /export const (use\w+Store)\b/.exec(source)?.[1] ?? null,
    }));

describe('sign-out guard helpers', () => {
  it('detects persist calls with or without a type argument', () => {
    expect(
      PERSIST_CALL.test('create<S>()(persist<S>((set) => ({}), {}))'),
    ).toBe(true);
    expect(PERSIST_CALL.test('create()(persist ((set) => ({}), {}))')).toBe(
      true,
    );
    expect(PERSIST_CALL.test('const persisted = true;')).toBe(false);
  });

  it('ignores resets that only appear in comments or outside the wiring', () => {
    const fixture = [
      '// useCartStore.persist.clearStorage();',
      'const OTHER = () => useCartStore.persist.clearStorage();',
      'const SIGN_OUT_WIRING: SignOutWiring = {',
      '  userDataResets: [',
      '    () => {',
      '      useCartStore.getState().clearCart();',
      '      /* useCartStore.persist.clearStorage(); */',
      '    },',
      '  ],',
      '};',
    ].join('\n');
    expect(
      missingResets(wiringBlock(fixture), [
        { path: 'cart.ts', name: 'useCartStore' },
      ]),
    ).toEqual(['useCartStore (cart.ts): persist.clearStorage() not called']);
  });
});

describe('sign-out reset list in app/_layout.tsx', () => {
  it('finds the persisted stores it is meant to guard', () => {
    const names = persistedStores().map((store) => store.name);
    expect(names).toContain('useCartStore');
    expect(names.every((name) => name !== null)).toBe(true);
  });

  it('resets every persisted store and clears its AsyncStorage key', () => {
    const wiring = wiringBlock(layoutSource);
    expect(wiring).toContain('userDataResets');
    expect(missingResets(wiring, persistedStores())).toEqual([]);
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
