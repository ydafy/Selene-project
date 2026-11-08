// source-text: the probes hold the read patterns this guard looks for
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';
import {
  findSourceTextProblems,
  SOURCE_TEXT_TEST_COUNTS,
  sourceTextArea,
} from './source-text-tests';

const root = join(import.meta.dir, '..', '..');

const READER = "const text = readFileSync('./order-card.tsx', 'utf8');";
const MARKED = `// source-text: a migration must not grant the function to anon\n${READER}`;
const RULE = 'docs/conventions.md, "Source-text tests"';

describe('source-text tests (probes)', () => {
  it('reports a new reader in an area past its recorded count', () => {
    expect(
      findSourceTextProblems(
        [{ path: 'apps/frontend/src/orders/order-card.test.ts', text: READER }],
        { 'apps/frontend': 0 },
      ),
    ).toEqual([
      `apps/frontend: test files that read files without a marker went from 0 to 1. Test the behavior instead, or add a "// source-text: <reason>" line where the text is the contract (${RULE})`,
    ]);
  });

  it('accepts the same reader with a marker', () => {
    expect(
      findSourceTextProblems(
        [{ path: 'apps/frontend/src/orders/order-card.test.ts', text: MARKED }],
        { 'apps/frontend': 0 },
      ),
    ).toEqual([]);
  });

  it('counts Bun.file and readFile reads, and treats an unrecorded area as 0', () => {
    expect(
      findSourceTextProblems(
        [
          { path: 'e2e/a.test.ts', text: "await Bun.file('a.ts').text();" },
          { path: 'e2e/b.test.tsx', text: "await readFile('b.ts', 'utf8');" },
        ],
        {},
      ),
    ).toEqual([
      `e2e: test files that read files without a marker went from 0 to 2. Test the behavior instead, or add a "// source-text: <reason>" line where the text is the contract (${RULE})`,
    ]);
  });

  it('asks to lower the number when an area drops below it', () => {
    expect(
      findSourceTextProblems(
        [{ path: 'supabase/migrations/__tests__/a.test.ts', text: READER }],
        { 'supabase/migrations': 3, scripts: 1 },
      ),
    ).toEqual([
      "scripts: test files that read files without a marker went from 1 to 0; lower SOURCE_TEXT_TEST_COUNTS['scripts'] to 0",
      "supabase/migrations: test files that read files without a marker went from 3 to 1; lower SOURCE_TEXT_TEST_COUNTS['supabase/migrations'] to 1",
    ]);
  });

  it('reports a marker with no reason, and still counts the file', () => {
    const path = 'scripts/a.test.ts';
    expect(
      findSourceTextProblems([{ path, text: `// source-text:\n${READER}` }], {
        scripts: 1,
      }),
    ).toEqual([`${path}: "// source-text:" needs a reason (${RULE})`]);
  });

  it('ignores files that read nothing and files that are not tests', () => {
    expect(
      findSourceTextProblems(
        [
          {
            path: 'apps/frontend/src/a.test.ts',
            text: "import { a } from './a';",
          },
          { path: 'apps/frontend/src/a.ts', text: READER },
        ],
        {},
      ),
    ).toEqual([]);
  });

  it('keeps an area when files move inside it', () => {
    expect(
      sourceTextArea('supabase/functions/_shared/__tests__/a.test.ts'),
    ).toBe('supabase/functions');
    expect(
      sourceTextArea('supabase/functions/_shared/stripe/stripe-charge.test.ts'),
    ).toBe('supabase/functions');
    expect(sourceTextArea('apps/admin-web/src/features/verify/a.test.ts')).toBe(
      'apps/admin-web',
    );
    expect(sourceTextArea('scripts/verify/a.test.ts')).toBe('scripts');
    expect(sourceTextArea('packages/types/src/a.test.ts')).toBe(
      'packages/types',
    );
    expect(sourceTextArea('eslint.config.test.ts')).toBe('.');
  });
});

describe('source-text tests (repository)', () => {
  it('matches the recorded count of every area', () => {
    const tests = listRepoFiles(root)
      .filter((path) => /\.test\.tsx?$/.test(path))
      .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
    expect(findSourceTextProblems(tests, SOURCE_TEXT_TEST_COUNTS)).toEqual([]);
  });
});
