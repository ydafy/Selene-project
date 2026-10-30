import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const workflow = readFileSync(
  join(root, '.github/workflows/dependency-audit.yml'),
  'utf8',
);
const lockfile = readFileSync(join(root, 'bun.lock'), 'utf8');

// bun audit --ignore applies to every copy of a package, so an exception granted
// for build tooling would also hide a vulnerable copy that ships at runtime.
describe('GHSA-mrhx-c7xc-m3w5 exception (zod < 4.6.6)', () => {
  const zodEntries = [
    ...lockfile.matchAll(/^\s*"((?:[^"]+\/)?zod)": \["zod@([\d.]+)"/gm),
  ].map(([, key, version]) => ({ key, version }));

  it('is ignored by the weekly audit with its reason', () => {
    expect(workflow).toContain('--ignore=GHSA-mrhx-c7xc-m3w5');
    expect(workflow).toMatch(
      /#\s+GHSA-mrhx-c7xc-m3w5 zod 3\.25\.\d+ \(@expo\/cli/,
    );
  });

  it('only covers the copy that @expo/cli brings', () => {
    const unpatched = zodEntries.filter(
      ({ version }) => Bun.semver.order(version, '4.6.6') < 0,
    );

    expect(zodEntries.length).toBeGreaterThan(0);
    expect(unpatched.map(({ key }) => key)).toEqual(['@expo/cli/zod']);
  });
});

describe('GHSA-qr28-fpjm-wq7f exception (decode-uri-component <= 0.5.0)', () => {
  const copies = [
    ...lockfile.matchAll(
      /^\s*"((?:[^"]+\/)?decode-uri-component)": \["decode-uri-component@([\d.]+)"/gm,
    ),
  ].map(([, key, version]) => ({ key, version }));
  const dependents = [
    ...lockfile.matchAll(
      /^\s*"([^"]+)": \["([^"@]+@[\d.]+)", "", \{[^\n]*"decode-uri-component": "/gm,
    ),
  ].map(([, , pkg]) => pkg);

  it('is ignored by the weekly audit with its reason', () => {
    expect(workflow).toContain('--ignore=GHSA-qr28-fpjm-wq7f');
    expect(workflow).toMatch(
      /#\s+GHSA-qr28-fpjm-wq7f decode-uri-component 0\.2\.\d+ \(expo-router/,
    );
  });

  it('only covers the copy that query-string 7 brings for expo-router', () => {
    expect(copies).toEqual([{ key: 'decode-uri-component', version: '0.2.2' }]);
    expect(dependents).toEqual(['query-string@7.1.3']);
  });
});
