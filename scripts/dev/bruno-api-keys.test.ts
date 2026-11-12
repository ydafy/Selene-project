// source-text: which key variable a Bruno request sends is only visible in the .bru file
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// bruno/environments/local.bru defines only publishableKey and secretKey (#337). A request that
// still names the legacy anonKey or serviceRoleKey sends an unresolved key and tests nothing.
const BRUNO_DIR = join(import.meta.dir, '..', '..', 'bruno');

const bruFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return bruFiles(path);
    return entry.name.endsWith('.bru') ? [path] : [];
  });

describe('Bruno requests use the API key variables local.bru defines', () => {
  const files = bruFiles(BRUNO_DIR);

  it('scans the whole collection', () => {
    expect(files.length).toBeGreaterThan(600);
  });

  it('no request names the legacy anonKey or serviceRoleKey', () => {
    expect(
      files.filter((file) =>
        /\banonKey\b|\bserviceRoleKey\b/.test(readFileSync(file, 'utf8')),
      ),
    ).toEqual([]);
  });
});
