import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The repository root has a package.json, so Deno 2 resolves `npm:` specifiers
// from the Bun-installed node_modules. `deno check` of every function wrapped in
// withSentry fails unless the exact SDK version pinned in sentry.ts is installed.
const repoRoot = join(import.meta.dir, '..', '..', '..', '..');

const pinnedSdkVersion = (): string => {
  const source = readFileSync(
    join(repoRoot, 'supabase/functions/_shared/sentry.ts'),
    'utf8',
  );
  const match = source.match(/import\('npm:@sentry\/deno@([^']+)'\)/);
  if (!match)
    throw new Error('sentry.ts no longer imports npm:@sentry/deno@<version>');
  return match[1];
};

describe('Sentry SDK install for deno check', () => {
  it('installs @sentry/deno as an exact root dev dependency matching sentry.ts', () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    );

    expect(pkg.devDependencies?.['@sentry/deno']).toBe(pinnedSdkVersion());
  });

  it('installs an exact root @types/node, which Deno needs to type-check npm packages', () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    );

    expect(pkg.devDependencies?.['@types/node']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
