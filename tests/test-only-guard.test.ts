import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_DIR = join(import.meta.dir, '..');
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.bun']);
const ONLY_PATTERN = /\b(?:describe|it|test|beforeAll|beforeEach|afterAll|afterEach)\.only\s*\(/;

const collectTestFiles = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        files.push(...collectTestFiles(fullPath));
      }

      continue;
    }

    if (TEST_FILE_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

describe('test.only guard', () => {
  it('fails if any test file uses .only', () => {
    const offenders = collectTestFiles(ROOT_DIR).filter((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return ONLY_PATTERN.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
