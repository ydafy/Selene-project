// source-text: the env variable name is the contract with every .env and the admin-web build env
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', '..');
const APP = join(SRC, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });

describe('admin-web Supabase client key', () => {
  it('reads the publishable key and fails at startup without it', () => {
    const client = readFileSync(join(SRC, 'shared/lib/supabase.ts'), 'utf8');

    expect(client).toContain('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(client).toMatch(/if \(!supabaseUrl \|\| !supabasePublishableKey\)/);
  });

  it('injects the publishable key at build time', () => {
    const config = readFileSync(join(APP, 'vite.config.ts'), 'utf8');

    expect(config).toContain("'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY'");
    expect(config).not.toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('never reads the legacy anon key variable, so a leftover one fails loudly', () => {
    const readers = sourceFiles(SRC).filter((path) =>
      readFileSync(path, 'utf8').includes('VITE_SUPABASE_ANON_KEY'),
    );

    expect(readers).toEqual([]);
  });
});
