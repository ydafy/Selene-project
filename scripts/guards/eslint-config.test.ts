import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

// The root eslint.config.js must give the same result wherever ESLint runs:
// `bun run lint` runs it from the repository root, and editors and lint-staged
// may run it from an app directory.
const ROOT = join(import.meta.dir, '..', '..');

type LintMessage = { ruleId: string | null; message: string };

async function lintText(cwd: string, filePath: string, source: string) {
  const proc = Bun.spawn(
    [
      'bunx',
      'eslint',
      '--format',
      'json',
      '--stdin',
      '--stdin-filename',
      filePath,
    ],
    {
      cwd: join(ROOT, cwd),
      stdin: new Blob([source]),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const messages: LintMessage[] =
    exitCode === 2 ? [] : JSON.parse(stdout)[0].messages;
  return { exitCode, stderr, ruleIds: messages.map((m) => m.ruleId) };
}

const FRONTEND_CASES = [
  { cwd: '.', prefix: 'apps/frontend/' },
  { cwd: 'apps/frontend', prefix: '' },
];

describe('root ESLint config', () => {
  for (const { cwd, prefix } of FRONTEND_CASES) {
    test(`flags a frontend shared file importing a feature when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/shared/utils/probe.ts`,
        "import '../../features/cart/hooks/use-cart-validation';\n",
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
      expect(result.ruleIds).toEqual(['import-x/no-restricted-paths']);
    }, 60_000);

    test(`accepts a frontend shared file importing shared code when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/shared/utils/probe.ts`,
        "import './compare';\n",
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.ruleIds).toEqual([]);
    }, 60_000);
  }

  test('flags a frontend feature importing another feature but not itself', async () => {
    const result = await lintText(
      '.',
      'apps/frontend/src/features/cart/hooks/probe.ts',
      "import '../../checkout/logic/checkout-schema';\nimport './use-cart-validation';\n",
    );

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(1);
    expect(result.ruleIds).toEqual(['import-x/no-restricted-paths']);
  }, 60_000);
});
