import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Node and Bun each have one source of truth: `.nvmrc` and `packageManager`.
// EAS Build reads neither, so every `eas.json` profile repeats them; this guard
// fails when a runtime update misses a copy (docs/dependencies.md, "Runtimes").
const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const nvmrc = read('.nvmrc').trim();
const packageManager = (
  JSON.parse(read('package.json')) as { packageManager: string }
).packageManager;
const profiles = Object.entries(
  (
    JSON.parse(read('apps/frontend/eas.json')) as {
      build: Record<string, { node?: string; bun?: string }>;
    }
  ).build,
);

describe('runtime versions', () => {
  it('pins an exact Node version from an LTS line in .nvmrc', () => {
    expect(nvmrc).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number(nvmrc.split('.')[0]) % 2).toBe(0);
  });

  it('pins an exact Bun version in packageManager', () => {
    expect(packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
  });

  it('uses the .nvmrc Node version in every eas.json profile', () => {
    expect(profiles.length).toBeGreaterThan(0);
    for (const [name, profile] of profiles) {
      expect({ name, node: profile.node }).toEqual({ name, node: nvmrc });
    }
  });

  it('uses the packageManager Bun version in every eas.json profile', () => {
    const bun = packageManager.replace(/^bun@/, '');
    for (const [name, profile] of profiles) {
      expect({ name, bun: profile.bun }).toEqual({ name, bun });
    }
  });

  it('sets up Node from .nvmrc in the dependency report workflow', () => {
    expect(read('.github/workflows/dependency-report.yml')).toContain(
      'node-version-file: .nvmrc',
    );
  });
});
