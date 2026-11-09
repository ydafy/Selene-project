import { afterAll, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// source-text: reads the scratch repository after the converter ran; the rewritten text is its output.

const SCRIPT = path.join(import.meta.dir, 'alias-imports.ts');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'alias-imports-'));
  scratch.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function run(root: string, args: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...args, '--root', root], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: r.exitCode,
    out: r.stdout.toString(),
    err: r.stderr.toString(),
  };
}

const read = (root: string, rel: string) =>
  readFileSync(path.join(root, rel), 'utf8');
const A = 'apps/admin-web';
const F = 'apps/frontend';

describe('rewrites relative specifiers that leave the top-level folder', () => {
  test('app/ importing shared/ and a feature', () => {
    const root = makeRepo({
      [`${A}/src/app/app.tsx`]:
        "import { Modal } from '../shared/ui/modal';\nimport Home from '../features/home/screens/home-page.tsx';\nimport { Layout } from './layout';\n",
    });
    const r = run(root, [A, '--apply']);
    expect(r.code).toBe(0);
    expect(read(root, `${A}/src/app/app.tsx`)).toBe(
      "import { Modal } from '@/shared/ui/modal';\nimport Home from '@/features/home/screens/home-page.tsx';\nimport { Layout } from './layout';\n",
    );
  });

  test('a feature importing shared/ and another feature, keeping its own ../ imports', () => {
    const root = makeRepo({
      [`${A}/src/features/payments/components/table.tsx`]:
        "import { s } from '../../../shared/lib/supabase';\nimport { t } from '../../shipments/logic/tone';\nimport { x } from '../logic/x';\nimport { y } from './y';\nexport * from \"../../../shared/utils/money\";\n",
    });
    run(root, [A, '--apply']);
    expect(read(root, `${A}/src/features/payments/components/table.tsx`)).toBe(
      "import { s } from '@/shared/lib/supabase';\nimport { t } from '@/features/shipments/logic/tone';\nimport { x } from '../logic/x';\nimport { y } from './y';\nexport * from \"@/shared/utils/money\";\n",
    );
  });

  test('a feature path that goes up and back into the same feature stays relative', () => {
    const root = makeRepo({
      [`${A}/src/features/users/screens/page.tsx`]:
        "import { a } from '../../users/hooks/use-a';\n",
    });
    run(root, [A, '--apply']);
    expect(read(root, `${A}/src/features/users/screens/page.tsx`)).toBe(
      "import { a } from '../../users/hooks/use-a';\n",
    );
  });

  test('shared/ importing inside shared/ stays relative', () => {
    const root = makeRepo({
      [`${A}/src/shared/ui/button.tsx`]:
        "import { cn } from '../utils/cn';\nimport { b } from '../../shared/lib/b';\n",
    });
    run(root, [A, '--apply']);
    expect(read(root, `${A}/src/shared/ui/button.tsx`)).toBe(
      "import { cn } from '../utils/cn';\nimport { b } from '../../shared/lib/b';\n",
    );
  });

  test('a file directly under src/ importing app/ and shared/', () => {
    const root = makeRepo({
      [`${A}/src/main.tsx`]:
        "import { q } from './shared/lib/query-client';\nimport App from './app/app.tsx';\nimport React from 'react';\n",
    });
    run(root, [A, '--apply']);
    expect(read(root, `${A}/src/main.tsx`)).toBe(
      "import { q } from '@/shared/lib/query-client';\nimport App from '@/app/app.tsx';\nimport React from 'react';\n",
    );
  });

  test('files directly under src/ form one group, so siblings stay relative', () => {
    const text =
      "import './index.css';\nimport type { Env } from './vite-env';\n";
    const root = makeRepo({ [`${A}/src/main.tsx`]: text });
    const r = run(root, [A, '--apply']);
    expect(r.out).toContain('0 specifiers rewritten');
    expect(read(root, `${A}/src/main.tsx`)).toBe(text);
  });

  test('a file directly under src/ importing a top-level folder index', () => {
    const root = makeRepo({
      [`${A}/src/main.tsx`]: "import { s } from './shared';\n",
      [`${A}/src/shared/index.ts`]: 'export const s = 1;\n',
    });
    run(root, [A, '--apply']);
    expect(read(root, `${A}/src/main.tsx`)).toBe(
      "import { s } from '@/shared';\n",
    );
  });

  test('mock.module, dynamic import(), and export from in a test', () => {
    const root = makeRepo({
      [`${A}/src/features/disputes/screens/page.test.tsx`]:
        "mock.module('../../../shared/lib/supabase', () => ({}));\nconst m = await import('../../../shared/lib/edge-client');\nexport { z } from '../../home/z';\nconst own = await import('./page');\n",
    });
    run(root, [A, '--apply']);
    expect(read(root, `${A}/src/features/disputes/screens/page.test.tsx`)).toBe(
      "mock.module('@/shared/lib/supabase', () => ({}));\nconst m = await import('@/shared/lib/edge-client');\nexport { z } from '@/features/home/z';\nconst own = await import('./page');\n",
    );
  });
});

describe('leaves everything else untouched', () => {
  test('alias, package, and non-specifier strings and comments', () => {
    const text =
      "import { a } from '@/shared/a';\nimport React from 'react';\n// import x from '../../../shared/x';\nexpect(src).toContain(\"from '../../shared/x'\");\nconst p = new URL('../../shared/x.ts', import.meta.url);\n";
    const root = makeRepo({ [`${A}/src/features/home/screens/a.tsx`]: text });
    const r = run(root, [A, '--apply']);
    expect(r.code).toBe(0);
    expect(read(root, `${A}/src/features/home/screens/a.tsx`)).toBe(text);
  });

  test('a specifier that leaves src/ stays relative', () => {
    const text = "import pkg from '../../package.json';\n";
    const root = makeRepo({ [`${A}/src/app/version.ts`]: text });
    run(root, [A, '--apply']);
    expect(read(root, `${A}/src/app/version.ts`)).toBe(text);
  });

  test('files outside src/ are not scanned', () => {
    const text = "import { s } from './src/shared/lib/supabase';\n";
    const root = makeRepo({ [`${A}/legacy.test.ts`]: text });
    run(root, [A, '--apply']);
    expect(read(root, `${A}/legacy.test.ts`)).toBe(text);
  });

  test('reports template specifiers without rewriting them', () => {
    const text = 'const m = await import(`../../shared/${name}`);\n';
    const root = makeRepo({ [`${A}/src/app/dyn.ts`]: text });
    const r = run(root, [A, '--apply']);
    expect(read(root, `${A}/src/app/dyn.ts`)).toBe(text);
    expect(r.out).toContain(
      `${A}/src/app/dyn.ts:1: template specifier not rewritten`,
    );
  });
});

describe('plan and options', () => {
  test('dry run by default: prints the plan and changes nothing', () => {
    const text = "import { s } from '../shared/lib/supabase';\n";
    const root = makeRepo({
      [`${A}/src/app/app.tsx`]: text,
      [`${A}/src/app/layout.tsx`]: "import { l } from './app';\n",
    });
    const r = run(root, [A]);
    expect(r.code).toBe(0);
    expect(read(root, `${A}/src/app/app.tsx`)).toBe(text);
    expect(r.out).toContain(
      `${A}/src/app/app.tsx:1: ../shared/lib/supabase -> @/shared/lib/supabase`,
    );
    expect(r.out).not.toContain('layout.tsx');
    expect(r.out).toContain(
      'Summary (dry run, nothing changed): 1 files edited, 1 specifiers rewritten, 0 items to check manually',
    );
  });

  test('--apply prints the same summary without the dry-run note', () => {
    const root = makeRepo({
      [`${A}/src/app/app.tsx`]:
        "import { s } from '../shared/lib/supabase';\nimport { t } from '../shared/lib/t';\n",
    });
    const r = run(root, [A, '--apply']);
    expect(r.out).toContain(
      'Summary: 1 files edited, 2 specifiers rewritten, 0 items to check manually',
    );
  });

  test('works on the frontend, whose @/ alias maps to src', () => {
    const root = makeRepo({
      [`${F}/src/features/cart/hooks/use-cart.ts`]:
        "import { supabase } from '../../../shared/lib/supabase';\nimport { c } from '../logic/c';\n",
    });
    run(root, [F, '--apply']);
    expect(read(root, `${F}/src/features/cart/hooks/use-cart.ts`)).toBe(
      "import { supabase } from '@/shared/lib/supabase';\nimport { c } from '../logic/c';\n",
    );
  });

  test('accepts a trailing slash and backslashes in the app path', () => {
    const root = makeRepo({
      [`${A}/src/app/app.tsx`]: "import { s } from '../shared/s';\n",
    });
    const r = run(root, ['apps\\admin-web\\', '--apply']);
    expect(r.code).toBe(0);
    expect(read(root, `${A}/src/app/app.tsx`)).toBe(
      "import { s } from '@/shared/s';\n",
    );
  });

  test('fails without an app, with an unknown app, or with an unknown option', () => {
    const root = makeRepo({ [`${A}/src/app/app.tsx`]: '\n' });
    const missing = run(root, []);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(
      'Usage: bun scripts/dev/alias-imports.ts <app> [--apply] [--root <repoRoot>]',
    );
    const unknown = run(root, ['apps/nope']);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain(
      'apps/nope has no @/ alias; known apps: apps/frontend, apps/admin-web',
    );
    const option = run(root, [A, '--write']);
    expect(option.code).toBe(1);
    expect(option.err).toContain('Unknown option --write.');
  });
});
