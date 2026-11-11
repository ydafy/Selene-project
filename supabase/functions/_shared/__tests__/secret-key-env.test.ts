// source-text: which environment variable a function reads for its privileged key is only visible in its source
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Supabase is retiring the legacy anon and service_role keys (#398). Privileged clients use the
// `default` secret key from SUPABASE_SECRET_KEYS, read only through _shared/supabase-secret-key.ts.
const FUNCTIONS_DIR = join(import.meta.dir, '..', '..');
const SECRET_KEY_MODULE = '_shared/supabase-secret-key.ts';

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === '__tests__' || entry.name === 'node_modules'
        ? []
        : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });

// Comments are stripped so a name that appears only in a comment does not count.
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SOURCES = sourceFiles(FUNCTIONS_DIR).map((file) => ({
  file: relative(FUNCTIONS_DIR, file).split(sep).join('/'),
  source: stripComments(readFileSync(file, 'utf8')),
}));

const filesMatching = (pattern: RegExp): string[] =>
  SOURCES.filter(({ source }) => pattern.test(source)).map(({ file }) => file);

describe('Edge Functions read the secret key from SUPABASE_SECRET_KEYS', () => {
  it('scans every function source', () => {
    expect(SOURCES.length).toBeGreaterThan(40);
    expect(SOURCES.map(({ file }) => file)).toContain(SECRET_KEY_MODULE);
  });

  it('no source reads SUPABASE_SERVICE_ROLE_KEY', () => {
    expect(filesMatching(/SUPABASE_SERVICE_ROLE_KEY/)).toEqual([]);
  });

  it('no source reads SUPABASE_ANON_KEY', () => {
    expect(filesMatching(/SUPABASE_ANON_KEY/)).toEqual([]);
  });

  it('only the shared module reads SUPABASE_SECRET_KEYS', () => {
    expect(filesMatching(/SUPABASE_SECRET_KEYS/)).toEqual([SECRET_KEY_MODULE]);
  });

  it('every file outside _shared/ that creates a client reads the key through readSupabaseSecretKey', () => {
    const creators = filesMatching(/createClient\s*[<(]/).filter(
      (file) => !file.startsWith('_shared/'),
    );
    expect(creators.length).toBeGreaterThan(30);
    expect(
      creators.filter(
        (file) =>
          !SOURCES.find((entry) => entry.file === file)?.source.includes(
            'readSupabaseSecretKey(',
          ),
      ),
    ).toEqual([]);
  });
});
