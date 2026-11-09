import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

// Runs from the repository root, like `bun run lint`: eslint.config.js builds
// its zones from repository-relative paths.
const eslint = new ESLint({ cwd: import.meta.dir });

const ruleHits = async (filePath: string, code = 'export const x = 1;\n') => {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map(
    (message) => `${message.ruleId}:${message.severity}`,
  );
};

const codeLines = (count: number) =>
  Array.from({ length: count }, (_, i) => `export const v${i} = ${i};`).join(
    '\n',
  ) + '\n';

const KEBAB_ERROR = 'check-file/filename-naming-convention:2';
const SIZE_WARNING = 'max-lines:1';
const SIZE_ERROR = 'max-lines:2';

describe('kebab-case file names under apps/frontend/src', () => {
  for (const name of [
    'fooBar.ts',
    'FooBar.tsx',
    'foo_bar.ts',
    'fooBar.logic.ts',
  ]) {
    test(`flags ${name}`, async () => {
      expect(
        await ruleHits(`apps/frontend/src/features/foo/${name}`),
      ).toContain(KEBAB_ERROR);
    });
  }

  for (const path of [
    'features/foo/foo-bar.ts',
    'shared/lib/x.logic.ts',
    'features/foo/x.mount.test.tsx',
    'features/foo/a.topic-name.test.ts',
    'app/(auth)/forgotPassword.tsx',
    'app/store/[id].tsx',
    'app/_layout.tsx',
  ]) {
    test(`allows ${path}`, async () => {
      expect(await ruleHits(`apps/frontend/src/${path}`)).not.toContain(
        KEBAB_ERROR,
      );
    });
  }

  test('does not check files outside apps/frontend/src', async () => {
    expect(await ruleHits('scripts/dev/useFooBar.ts')).not.toContain(
      KEBAB_ERROR,
    );
  });
});

describe('max-lines warning (#135)', () => {
  const file = 'apps/frontend/src/features/foo/big.ts';

  test('400 lines of code pass', async () => {
    expect(await ruleHits(file, codeLines(400))).not.toContain(SIZE_WARNING);
  });

  test('401 lines of code warn and never error', async () => {
    const hits = await ruleHits(file, codeLines(401));
    expect(hits).toContain(SIZE_WARNING);
    expect(hits).not.toContain(SIZE_ERROR);
  });

  test('blank lines and comments are not counted', async () => {
    const padded = codeLines(390) + '\n// note\n'.repeat(60);
    expect(await ruleHits(file, padded)).not.toContain(SIZE_WARNING);
  });

  test('test files are exempt', async () => {
    expect(
      await ruleHits(
        'apps/frontend/src/features/foo/big.test.ts',
        codeLines(401),
      ),
    ).not.toContain(SIZE_WARNING);
  });
});
