import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FUNCTIONS = join(import.meta.dir, '..', '..');
const TYPES = join(FUNCTIONS, '..', '..', 'packages', 'types', 'src');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });

// Deno resolves only explicit extensions. packages/types/src/index.ts re-exports the
// domain constants without one (the app typecheck needs that), so Edge Functions read
// their types from types.ts, which imports only files that Deno can resolve.
describe('Edge Functions import shared types Deno can resolve', () => {
  it('never import packages/types/src/index.ts', () => {
    const offenders = sources(FUNCTIONS).filter((file) =>
      readFileSync(file, 'utf8').includes('packages/types/src/index'),
    );
    expect(offenders).toEqual([]);
  });

  it('types.ts has only type exports and explicit .ts relative imports', () => {
    const types = readFileSync(join(TYPES, 'types.ts'), 'utf8');
    const relative = [...types.matchAll(/from '(\.[^']+)'/g)].map((m) => m[1]);
    expect(relative.length).toBeGreaterThan(0);
    for (const spec of relative) expect(spec.endsWith('.ts')).toBe(true);
    expect(types).not.toMatch(/^export (const|function|class|enum|\{)/m);
  });

  it('index.ts still offers the types and the domain constants to the apps', () => {
    const index = readFileSync(join(TYPES, 'index.ts'), 'utf8');
    expect(index).toContain("export type * from './types.ts';");
    expect(index).toContain("from './domain';");
  });
});
