import { afterAll, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// source-text: reads the scratch repository after the codemod ran; the rewritten text is its output.

const SCRIPT = path.join(import.meta.dir, 'move-files.ts');
const scratch: string[] = [];

// Without GIT_* variables: a git hook exports GIT_DIR for the real repository,
// and a scratch command that inherits it writes there (#221, L24).
const ENV: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && !key.startsWith('GIT_')) ENV[key] = value;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  const r = Bun.spawnSync(
    [
      'git',
      '-c',
      'user.email=t@t.test',
      '-c',
      'user.name=t',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, env: ENV, stdout: 'pipe', stderr: 'pipe' },
  );
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
}

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'move-files-'));
  scratch.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'core.autocrlf', 'false');
  const all: Record<string, string> = {
    'apps/frontend/tsconfig.json': '{}\n',
    'apps/frontend/assets/img.png': 'png',
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return root;
}

function run(root: string, pairs: unknown, extra: string[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'move-files-map-'));
  scratch.push(dir);
  const mapping = path.join(dir, 'mapping.json');
  writeFileSync(mapping, JSON.stringify(pairs));
  const r = Bun.spawnSync(
    [process.execPath, SCRIPT, mapping, '--root', root, ...extra],
    {
      env: ENV,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  return {
    code: r.exitCode,
    out: r.stdout.toString(),
    err: r.stderr.toString(),
  };
}

const read = (root: string, rel: string) =>
  readFileSync(path.join(root, rel), 'utf8');
const F = 'apps/frontend';
const A = 'apps/admin-web';

describe('scratch repositories', () => {
  // A git hook (pre-push runs `bun test`) exports GIT_DIR for the real
  // repository; a scratch command that inherits it writes there instead.
  test('ignore a GIT_DIR inherited from a git hook', () => {
    const victim = mkdtempSync(path.join(tmpdir(), 'move-files-victim-'));
    scratch.push(victim);
    const victimGit = (...args: string[]) =>
      Bun.spawnSync(
        ['git', '-c', 'user.email=v@v.test', '-c', 'user.name=v', ...args],
        { cwd: victim, env: ENV, stdout: 'pipe', stderr: 'pipe' },
      )
        .stdout.toString()
        .trim();
    victimGit('init', '-q');
    writeFileSync(path.join(victim, 'keep.txt'), 'keep\n');
    victimGit('add', '-A');
    victimGit('commit', '-qm', 'victim');
    const head = victimGit('rev-parse', 'HEAD');

    // Bun spawns with the environment the process started with, so the
    // hook's GIT_DIR has to reach a child test run, as it does in pre-push.
    const child = Bun.spawnSync(
      [
        process.execPath,
        'test',
        import.meta.path,
        '-t',
        'rewrites alias imports of a moved file',
      ],
      {
        env: { ...ENV, GIT_DIR: path.join(victim, '.git') },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    expect(victimGit('rev-parse', 'HEAD')).toBe(head);
    expect(victimGit('config', '--local', '--get', 'core.autocrlf')).toBe('');
  });
});

describe('module specifiers', () => {
  test('rewrites alias imports of a moved file', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/src/app/home.tsx`]:
        "import { a } from '@/components/ProductCard';\n",
    });
    const r = run(root, [
      [
        `${F}/src/components/ProductCard.tsx`,
        `${F}/src/features/catalog/product-card.tsx`,
      ],
    ]);
    expect(r.code).toBe(0);
    expect(read(root, `${F}/src/app/home.tsx`)).toBe(
      "import { a } from '@/features/catalog/product-card';\n",
    );
    expect(
      existsSync(path.join(root, `${F}/src/features/catalog/product-card.tsx`)),
    ).toBe(true);
    expect(
      existsSync(path.join(root, `${F}/src/components/ProductCard.tsx`)),
    ).toBe(false);
    expect(r.out).toContain('1 files moved');
  });

  test('rewrites relative imports from an unmoved file', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/src/components/List.tsx`]:
        "import { a } from './ProductCard';\nexport * from './ProductCard';\n",
      [`${F}/src/app/home.tsx`]:
        'import { a } from "../components/ProductCard";\n',
    });
    run(root, [
      [
        `${F}/src/components/ProductCard.tsx`,
        `${F}/src/features/catalog/product-card.tsx`,
      ],
    ]);
    expect(read(root, `${F}/src/components/List.tsx`)).toBe(
      "import { a } from '../features/catalog/product-card';\nexport * from '../features/catalog/product-card';\n",
    );
    expect(read(root, `${F}/src/app/home.tsx`)).toBe(
      'import { a } from "../features/catalog/product-card";\n',
    );
  });

  test('rewrites relative imports inside a moved file to unmoved files', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]:
        "import { t } from '../core/i18n';\nimport u from './util';\nimport '../core/setup';\nimport x from '@/core/x';\nimport React from 'react';\n",
      [`${F}/src/components/util.ts`]: 'export default 1;\n',
      [`${F}/src/core/i18n/index.ts`]: 'export const t = 1;\n',
      [`${F}/src/core/setup.ts`]: '\n',
      [`${F}/src/core/x.ts`]: '\n',
    });
    run(root, [
      [
        `${F}/src/components/ProductCard.tsx`,
        `${F}/src/features/catalog/product-card.tsx`,
      ],
    ]);
    expect(read(root, `${F}/src/features/catalog/product-card.tsx`)).toBe(
      "import { t } from '../../core/i18n';\nimport u from '../../components/util';\nimport '../../core/setup';\nimport x from '@/core/x';\nimport React from 'react';\n",
    );
  });

  test('handles a moved file importing another moved file', () => {
    const root = makeRepo({
      [`${F}/src/components/A.tsx`]:
        "import { b } from './B';\nexport const a = b;\n",
      [`${F}/src/components/B.tsx`]: 'export const b = 1;\n',
    });
    const r = run(root, [
      [`${F}/src/components/A.tsx`, `${F}/src/features/x/a.tsx`],
      [`${F}/src/components/B.tsx`, `${F}/src/shared/ui/b.tsx`],
    ]);
    expect(r.code).toBe(0);
    expect(read(root, `${F}/src/features/x/a.tsx`)).toBe(
      "import { b } from '../../shared/ui/b';\nexport const a = b;\n",
    );
  });

  test('keeps extensionless and explicit extension styles', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/src/app/home.tsx`]:
        "import a from '../components/ProductCard';\nimport b from '../components/ProductCard.tsx';\n",
    });
    run(root, [
      [
        `${F}/src/components/ProductCard.tsx`,
        `${F}/src/shared/ui/product-card.tsx`,
      ],
    ]);
    expect(read(root, `${F}/src/app/home.tsx`)).toBe(
      "import a from '../shared/ui/product-card';\nimport b from '../shared/ui/product-card.tsx';\n",
    );
  });

  test('directory index: follows the directory, or the file when index moves alone', () => {
    const root = makeRepo({
      [`${F}/src/core/i18n/index.ts`]: "export * from './locales';\n",
      [`${F}/src/core/i18n/locales.ts`]: 'export const l = 1;\n',
      [`${F}/src/app/a.tsx`]:
        "import '@/core/i18n';\nimport '../core/i18n';\nimport '../core/i18n/index';\n",
    });
    run(root, [
      [`${F}/src/core/i18n/index.ts`, `${F}/src/shared/i18n/index.ts`],
      [`${F}/src/core/i18n/locales.ts`, `${F}/src/shared/i18n/locales.ts`],
    ]);
    expect(read(root, `${F}/src/app/a.tsx`)).toBe(
      "import '@/shared/i18n';\nimport '../shared/i18n';\nimport '../shared/i18n/index';\n",
    );
    expect(read(root, `${F}/src/shared/i18n/index.ts`)).toBe(
      "export * from './locales';\n",
    );

    const root2 = makeRepo({
      [`${F}/src/core/i18n/index.ts`]: 'export const t = 1;\n',
      [`${F}/src/app/a.tsx`]: "import '@/core/i18n';\n",
    });
    run(root2, [
      [`${F}/src/core/i18n/index.ts`, `${F}/src/shared/i18n/main.ts`],
    ]);
    expect(read(root2, `${F}/src/app/a.tsx`)).toBe(
      "import '@/shared/i18n/main';\n",
    );
  });

  test('@/assets is untouched when assets stay, and relative asset paths follow a moved importer', () => {
    const root = makeRepo({
      [`${F}/src/components/Hero.tsx`]:
        "const a = require('@/assets/img.png');\nconst b = require('../../assets/img.png');\n",
    });
    run(root, [
      [`${F}/src/components/Hero.tsx`, `${F}/src/features/home/ui/hero.tsx`],
    ]);
    expect(read(root, `${F}/src/features/home/ui/hero.tsx`)).toBe(
      "const a = require('@/assets/img.png');\nconst b = require('../../../../assets/img.png');\n",
    );
  });

  test('@/assets alias follows a moved asset', () => {
    const root = makeRepo({
      [`${F}/src/components/Hero.tsx`]:
        "const a = require('@/assets/img.png');\n",
    });
    run(root, [[`${F}/assets/img.png`, `${F}/assets/images/img.png`]]);
    expect(read(root, `${F}/src/components/Hero.tsx`)).toBe(
      "const a = require('@/assets/images/img.png');\n",
    );
  });

  test('rewrites mock.module and dynamic import()', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/tests/card.test.ts`]:
        "mock.module('@/components/ProductCard', () => ({}));\nconst m = await import('../src/components/ProductCard');\njest.mock(`@/components/ProductCard`);\n",
    });
    run(root, [
      [
        `${F}/src/components/ProductCard.tsx`,
        `${F}/src/features/catalog/product-card.tsx`,
      ],
    ]);
    expect(read(root, `${F}/tests/card.test.ts`)).toBe(
      "mock.module('@/features/catalog/product-card', () => ({}));\nconst m = await import('../src/features/catalog/product-card');\njest.mock(`@/features/catalog/product-card`);\n",
    );
  });

  test('reports template specifiers without rewriting them', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/src/app/dyn.ts`]:
        'const m = await import(`../components/${name}`);\n',
    });
    const r = run(root, [
      [
        `${F}/src/components/ProductCard.tsx`,
        `${F}/src/shared/ui/product-card.tsx`,
      ],
    ]);
    expect(read(root, `${F}/src/app/dyn.ts`)).toBe(
      'const m = await import(`../components/${name}`);\n',
    );
    expect(r.out).toContain(
      `${F}/src/app/dyn.ts:1: template specifier not rewritten`,
    );
  });
});

describe('path strings', () => {
  const card = [
    `${F}/src/components/ProductCard.tsx`,
    `${F}/src/features/catalog/product-card.tsx`,
  ];

  test('readFileSync path relative to apps/frontend', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/tests/src.test.ts`]:
        "const s = readFileSync('src/components/ProductCard.tsx', 'utf8');\n",
    });
    const r = run(root, [card]);
    expect(read(root, `${F}/tests/src.test.ts`)).toBe(
      "const s = readFileSync('src/features/catalog/product-card.tsx', 'utf8');\n",
    );
    expect(r.out).toContain('1 path strings rewritten');
  });

  test('new URL(rel, import.meta.url)', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/tests/url.test.ts`]:
        "const u = new URL('../src/components/ProductCard.tsx', import.meta.url);\n",
    });
    run(root, [card]);
    expect(read(root, `${F}/tests/url.test.ts`)).toBe(
      "const u = new URL('../src/features/catalog/product-card.tsx', import.meta.url);\n",
    );
  });

  test('static tail of a ${import.meta.dir} template', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/tests/tpl.test.ts`]:
        'const p = `${import.meta.dir}/../src/components/ProductCard.tsx`;\n',
    });
    run(root, [card]);
    expect(read(root, `${F}/tests/tpl.test.ts`)).toBe(
      'const p = `${import.meta.dir}/../src/features/catalog/product-card.tsx`;\n',
    );
  });

  test('path string relative to the repo root', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      'tests/root.test.ts':
        "const p = 'apps/frontend/src/components/ProductCard.tsx';\n",
    });
    run(root, [card]);
    expect(read(root, 'tests/root.test.ts')).toBe(
      "const p = 'apps/frontend/src/features/catalog/product-card.tsx';\n",
    );
  });
});

describe('moves', () => {
  test('basename-only kebab rename with case change in a new directory', () => {
    const root = makeRepo({
      [`${F}/src/components/ui/Skeleton.tsx`]: 'export const S = 1;\n',
      [`${F}/src/app/a.tsx`]: "import { S } from '@/components/ui/Skeleton';\n",
    });
    const r = run(root, [
      [
        `${F}/src/components/ui/Skeleton.tsx`,
        `${F}/src/shared/ui/skeleton.tsx`,
      ],
    ]);
    expect(r.code).toBe(0);
    expect(read(root, `${F}/src/app/a.tsx`)).toBe(
      "import { S } from '@/shared/ui/skeleton';\n",
    );
    expect(git(root, 'ls-files')).toContain(`${F}/src/shared/ui/skeleton.tsx`);
    expect(git(root, 'ls-files')).not.toContain('Skeleton.tsx');
  });

  test('case-only rename in the same directory and chained moves', () => {
    const root = makeRepo({
      [`${F}/src/ui/Skeleton.tsx`]: 'export const S = 1;\n',
      [`${F}/src/ui/a.ts`]: 'export const a = 1;\n',
      [`${F}/src/ui/b.ts`]: 'export const b = 1;\n',
    });
    const r = run(root, [
      [`${F}/src/ui/Skeleton.tsx`, `${F}/src/ui/skeleton.tsx`],
      [`${F}/src/ui/a.ts`, `${F}/src/ui/b.ts`],
      [`${F}/src/ui/b.ts`, `${F}/src/ui/c.ts`],
    ]);
    expect(r.code).toBe(0);
    const files = git(root, 'ls-files');
    expect(files).toContain(`${F}/src/ui/skeleton.tsx`);
    expect(files).not.toContain('Skeleton.tsx');
    expect(read(root, `${F}/src/ui/b.ts`)).toBe('export const a = 1;\n');
    expect(read(root, `${F}/src/ui/c.ts`)).toBe('export const b = 1;\n');
  });

  test('validation failure changes nothing and exits 1', () => {
    const root = makeRepo({
      [`${F}/src/a.ts`]: 'export const a = 1;\n',
      [`${F}/src/b.ts`]: 'export const b = 1;\n',
      [`${F}/src/c.ts`]: "import { a } from './a';\n",
    });
    const cases: [string, string[][]][] = [
      ['does not exist', [[`${F}/src/missing.ts`, `${F}/src/x.ts`]]],
      ['already exists', [[`${F}/src/a.ts`, `${F}/src/b.ts`]]],
      [
        'Duplicate old',
        [
          [`${F}/src/a.ts`, `${F}/src/x.ts`],
          [`${F}/src/a.ts`, `${F}/src/y.ts`],
        ],
      ],
      [
        'Duplicate new',
        [
          [`${F}/src/a.ts`, `${F}/src/x.ts`],
          [`${F}/src/b.ts`, `${F}/src/x.ts`],
        ],
      ],
    ];
    for (const [message, pairs] of cases) {
      const r = run(root, pairs);
      expect(r.code).toBe(1);
      expect(r.err).toContain(message);
      expect(git(root, 'status', '--porcelain')).toBe('');
    }
  });

  test('--dry-run prints the plan and changes nothing', () => {
    const root = makeRepo({
      [`${F}/src/components/ProductCard.tsx`]: 'export const a = 1;\n',
      [`${F}/src/app/home.tsx`]:
        "import { a } from '@/components/ProductCard';\n",
    });
    const r = run(
      root,
      [
        [
          `${F}/src/components/ProductCard.tsx`,
          `${F}/src/features/catalog/product-card.tsx`,
        ],
      ],
      ['--dry-run'],
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      `${F}/src/components/ProductCard.tsx -> ${F}/src/features/catalog/product-card.tsx`,
    );
    expect(r.out).toContain(
      `${F}/src/app/home.tsx: 1 specifiers, 0 path strings`,
    );
    expect(git(root, 'status', '--porcelain')).toBe('');
  });
});

describe('admin-web', () => {
  test('rewrites admin-web alias imports of a moved admin-web file', () => {
    const root = makeRepo({
      [`${A}/src/lib/carrierReviews.ts`]: 'export const c = 1;\n',
      [`${A}/src/pages/HomePage.tsx`]:
        "import { c } from '@/lib/carrierReviews';\nmock.module('@/lib/carrierReviews', () => ({}));\n",
    });
    const r = run(root, [
      [
        `${A}/src/lib/carrierReviews.ts`,
        `${A}/src/features/shipments/lib/carrier-reviews.ts`,
      ],
    ]);
    expect(r.code).toBe(0);
    expect(read(root, `${A}/src/pages/HomePage.tsx`)).toBe(
      "import { c } from '@/features/shipments/lib/carrier-reviews';\nmock.module('@/features/shipments/lib/carrier-reviews', () => ({}));\n",
    );
  });

  test('rewrites relative and alias imports inside a moved admin-web file', () => {
    const root = makeRepo({
      [`${A}/src/pages/PaymentsPage.tsx`]:
        "import { s } from '../lib/supabase';\nimport { B } from './PayoutBuckets';\nimport { s as t } from '@/lib/supabase';\n",
      [`${A}/src/pages/PayoutBuckets.tsx`]: 'export const B = 1;\n',
      [`${A}/src/lib/supabase.ts`]: 'export const s = 1;\n',
    });
    run(root, [
      [
        `${A}/src/pages/PaymentsPage.tsx`,
        `${A}/src/features/payments/screens/payments-page.tsx`,
      ],
    ]);
    expect(
      read(root, `${A}/src/features/payments/screens/payments-page.tsx`),
    ).toBe(
      "import { s } from '../../../lib/supabase';\nimport { B } from '../../../pages/PayoutBuckets';\nimport { s as t } from '@/lib/supabase';\n",
    );
  });

  test('resolves @/ against the importing app only', () => {
    const root = makeRepo({
      [`${A}/src/lib/format.ts`]: 'export const f = 1;\n',
      [`${F}/src/lib/format.ts`]: 'export const f = 2;\n',
      [`${F}/src/app/home.tsx`]: "import { f } from '@/lib/format';\n",
      [`${A}/src/pages/HomePage.tsx`]: "import { f } from '@/lib/format';\n",
    });
    const r = run(root, [
      [`${A}/src/lib/format.ts`, `${A}/src/shared/utils/format.ts`],
    ]);
    expect(r.code).toBe(0);
    expect(read(root, `${F}/src/app/home.tsx`)).toBe(
      "import { f } from '@/lib/format';\n",
    );
    expect(read(root, `${A}/src/pages/HomePage.tsx`)).toBe(
      "import { f } from '@/shared/utils/format';\n",
    );
  });

  test('rewrites sibling path strings in an admin-web test', () => {
    const root = makeRepo({
      [`${A}/src/pages/LoginPage.tsx`]: 'export const L = 1;\n',
      [`${A}/src/pages/LoginPage.test.tsx`]:
        "const a = Bun.file(new URL('./LoginPage.tsx', import.meta.url));\nconst b = join(import.meta.dir, 'LoginPage.tsx');\nconst c = readFileSync('src/pages/LoginPage.tsx', 'utf8');\n",
    });
    run(root, [
      [
        `${A}/src/pages/LoginPage.tsx`,
        `${A}/src/features/auth/screens/login-page.tsx`,
      ],
    ]);
    expect(read(root, `${A}/src/pages/LoginPage.test.tsx`)).toBe(
      "const a = Bun.file(new URL('../features/auth/screens/login-page.tsx', import.meta.url));\nconst b = join(import.meta.dir, '../features/auth/screens/login-page.tsx');\nconst c = readFileSync('src/features/auth/screens/login-page.tsx', 'utf8');\n",
    );
  });

  test('keeps sibling path strings when an admin-web file and its test move together', () => {
    const root = makeRepo({
      [`${A}/src/pages/LoginPage.tsx`]: 'export const L = 1;\n',
      [`${A}/src/pages/LoginPage.test.tsx`]:
        "const a = Bun.file(new URL('./LoginPage.tsx', import.meta.url));\nconst b = join(import.meta.dir, 'LoginPage.tsx');\n",
    });
    run(root, [
      [
        `${A}/src/pages/LoginPage.tsx`,
        `${A}/src/features/auth/screens/login-page.tsx`,
      ],
      [
        `${A}/src/pages/LoginPage.test.tsx`,
        `${A}/src/features/auth/screens/login-page.test.tsx`,
      ],
    ]);
    expect(
      read(root, `${A}/src/features/auth/screens/login-page.test.tsx`),
    ).toBe(
      "const a = Bun.file(new URL('./login-page.tsx', import.meta.url));\nconst b = join(import.meta.dir, 'login-page.tsx');\n",
    );
  });
});

describe('manual-check report', () => {
  test('lists assertion strings that mention an old path and were not rewritten', () => {
    const root = makeRepo({
      [`${F}/src/old/Path.tsx`]: 'export const p = 1;\n',
      [`${F}/tests/assert.test.ts`]:
        "expect(src).toContain(\"from '../old/Path'\");\nconst unrelated = 'Pathology';\n",
    });
    const r = run(root, [
      [`${F}/src/old/Path.tsx`, `${F}/src/shared/path.tsx`],
    ]);
    expect(r.out).toContain(`${F}/tests/assert.test.ts:1: from '../old/Path'`);
    expect(r.out).not.toContain('Pathology');
    expect(read(root, `${F}/tests/assert.test.ts`)).toContain(
      "from '../old/Path'",
    );
  });
});
