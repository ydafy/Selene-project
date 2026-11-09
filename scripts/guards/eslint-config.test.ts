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

const RELATIVE_OUTSIDE = 'selene/relative-import-outside-folder';

const FRONTEND_CASES = [
  { cwd: '.', prefix: 'apps/frontend/' },
  { cwd: 'apps/frontend', prefix: '' },
];

const ADMIN_WEB_CASES = [
  { cwd: '.', prefix: 'apps/admin-web/' },
  { cwd: 'apps/admin-web', prefix: '' },
];

// Test-only and CommonJS module specifiers (`mock.module`, `jest.mock`,
// `require`) follow the same rule as imports, in both apps.
const CALL_CASES = [
  ...ADMIN_WEB_CASES.map((c) => ({
    ...c,
    app: 'admin-web',
    feature: 'payments',
  })),
  ...FRONTEND_CASES.map((c) => ({ ...c, app: 'frontend', feature: 'cart' })),
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
      expect(result.ruleIds).toEqual([
        'import-x/no-restricted-paths',
        RELATIVE_OUTSIDE,
      ]);
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
    expect(result.ruleIds).toEqual([
      'import-x/no-restricted-paths',
      RELATIVE_OUTSIDE,
    ]);
  }, 60_000);

  for (const { cwd, prefix } of FRONTEND_CASES) {
    test(`flags frontend relative imports leaving a feature or app/ when run from ${cwd}`, async () => {
      const feature = await lintText(
        cwd,
        `${prefix}src/features/cart/hooks/probe.ts`,
        "import '../../../shared/utils/probe';\n",
      );
      const route = await lintText(
        cwd,
        `${prefix}src/app/probe.tsx`,
        "export * from '../shared/ui/probe';\n",
      );

      expect([feature.stderr, route.stderr]).toEqual(['', '']);
      expect([feature.exitCode, route.exitCode]).toEqual([1, 1]);
      expect([...feature.ruleIds, ...route.ruleIds]).toEqual([
        RELATIVE_OUTSIDE,
        RELATIVE_OUTSIDE,
      ]);
    }, 60_000);

    test(`accepts frontend relative imports inside their folder and @/ imports when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/features/cart/hooks/probe.ts`,
        "import '../logic/probe';\nimport './use-cart-validation';\nimport '..';\nimport '@/shared/utils/probe';\n",
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.ruleIds).toEqual([]);
    }, 60_000);
  }

  for (const { cwd, prefix, app, feature } of CALL_CASES) {
    test(`flags relative mock.module, jest.mock and require specifiers leaving a ${app} feature when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/features/${feature}/hooks/probe.test.ts`,
        [
          "mock.module('../../../shared/x', () => ({}));",
          "jest.mock('../../../shared/x');",
          'jest.mock(`../../../shared/x`);',
          "require('../../../shared/x');",
          '',
        ].join('\n'),
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
      expect(
        result.ruleIds.filter((id) => id === RELATIVE_OUTSIDE),
      ).toHaveLength(4);
    }, 60_000);

    test(`accepts @/ mocks, template specifiers with expressions and other calls in ${app} when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/features/${feature}/hooks/probe.test.ts`,
        [
          'declare const name: string;',
          'declare function foo(spec: string): void;',
          "mock.module('@/shared/x', () => ({}));",
          'jest.mock(`../../../shared/${name}`);',
          "foo('../../../shared/x');",
          "mock.module('../logic/x', () => ({}));",
          '',
        ].join('\n'),
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.ruleIds).toEqual([]);
    }, 60_000);
  }

  for (const { cwd, prefix } of ADMIN_WEB_CASES) {
    test(`keeps the admin-web React hooks rules when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/hooks/probe.ts`,
        "import { useState } from 'react';\nexport function probe(flag: boolean) {\n  if (flag) useState(0);\n}\n",
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
      expect(result.ruleIds).toEqual(['react-hooks/rules-of-hooks']);
    }, 60_000);

    test(`flags an admin-web shared file importing app/ when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/shared/ui/probe.ts`,
        "import '../../app/app';\nimport '@/app/layout';\n",
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
      expect(result.ruleIds).toEqual([
        'import-x/no-restricted-paths',
        RELATIVE_OUTSIDE,
        'import-x/no-restricted-paths',
      ]);
    }, 60_000);

    test(`accepts an admin-web shared file importing shared code when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/shared/ui/probe.ts`,
        "import '@/shared/lib/supabase';\nimport './modal';\n",
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.ruleIds).toEqual([]);
    }, 60_000);

    test(`flags an admin-web app/ file importing shared/ relatively when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/app/probe.ts`,
        "import '../shared/ui/modal';\n",
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
      expect(result.ruleIds).toEqual([RELATIVE_OUTSIDE]);
    }, 60_000);

    test(`flags an admin-web feature reaching shared/ and another feature relatively when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/features/payments/components/probe.ts`,
        "export * from '../../../shared/utils/as-record';\nawait import('../../shipments/logic/carrier-reviews');\n",
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
      expect(
        result.ruleIds.filter((id) => id === RELATIVE_OUTSIDE),
      ).toHaveLength(2);
    }, 60_000);

    test(`accepts admin-web relative imports inside their folder and @/ imports when run from ${cwd}`, async () => {
      const feature = await lintText(
        cwd,
        `${prefix}src/features/payments/components/probe.ts`,
        "import '../logic/shipment-refund-problems';\nimport './copyable-reference';\nimport '../../payments/logic/connect-payout-release-queue';\nimport '@/shared/utils/as-record';\n",
      );
      const root = await lintText(
        cwd,
        `${prefix}src/main.tsx`,
        "import './index.css';\n",
      );

      expect([feature.stderr, root.stderr]).toEqual(['', '']);
      expect([feature.exitCode, root.exitCode]).toEqual([0, 0]);
      expect([...feature.ruleIds, ...root.ruleIds]).toEqual([]);
    }, 60_000);

    test(`flags a non-kebab-case admin-web file in shared/ when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/shared/ui/StatusProbe.ts`,
        'export const probe = 1;\n',
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
      expect(result.ruleIds).toEqual(['check-file/filename-naming-convention']);
    }, 60_000);

    test(`flags a non-kebab-case admin-web file in a former legacy folder when run from ${cwd}`, async () => {
      const result = await lintText(
        cwd,
        `${prefix}src/components/ui/StatusProbe.ts`,
        'export const probe = 1;\n',
      );

      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
      expect(result.ruleIds).toEqual(['check-file/filename-naming-convention']);
    }, 60_000);
  }

  test('flags a non-kebab-case Edge Function file', async () => {
    const result = await lintText(
      '.',
      'supabase/functions/_shared/envia/EnviaProbe.ts',
      'export const probe = 1;\n',
    );

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(1);
    expect(result.ruleIds).toEqual(['check-file/filename-naming-convention']);
  }, 60_000);

  test('warns on an Edge Function file past 400 lines of code, but not on a test', async () => {
    const long = Array.from(
      { length: 401 },
      (_, i) => `export const v${i} = ${i};`,
    ).join('\n');
    const module = await lintText(
      '.',
      'supabase/functions/_shared/envia/size-probe.ts',
      `${long}\n`,
    );
    const testFile = await lintText(
      '.',
      'supabase/functions/_shared/envia/size-probe.test.ts',
      `${long}\n`,
    );

    expect([module.stderr, testFile.stderr]).toEqual(['', '']);
    expect([module.exitCode, testFile.exitCode]).toEqual([0, 0]);
    expect(module.ruleIds).toEqual(['max-lines']);
    expect(testFile.ruleIds).toEqual([]);
  }, 60_000);
});
