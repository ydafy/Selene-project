// source-text: the env variable name is the contract with every .env and EAS environment, and Expo inlines only static process.env reads
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', '..');
const read = (relativePath: string) =>
  readFileSync(join(SRC, relativePath), 'utf8');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });

describe('Supabase client key', () => {
  it('reads the publishable key and fails at startup without it', () => {
    const client = read('shared/lib/supabase.ts');

    // Expo inlines only static `process.env.EXPO_PUBLIC_*` reads.
    expect(client).toContain(
      'process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
    expect(client).toMatch(/if \(!supabaseUrl \|\| !supabasePublishableKey\)/);
  });

  it('never reads the legacy anon key variable, so a leftover one fails loudly', () => {
    const readers = sourceFiles(SRC).filter((path) =>
      readFileSync(path, 'utf8').includes('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
    );

    expect(readers).toEqual([]);
  });
});
