import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';
import {
  collectNpmPinFiles,
  findNpmPinProblems,
  readRootDevDependencies,
} from './edge-function-npm-pins';

const root = join(import.meta.dir, '..');

const pins = { zod: '4.6.7', '@sentry/deno': '11.8.0' };

describe('Edge Function npm pins (probes)', () => {
  it('accepts specifiers that match the exact pins, scoped names and subpaths included', () => {
    expect(
      findNpmPinProblems(
        [
          {
            path: 'supabase/functions/_shared/zod-runtime.ts',
            text: "export { z } from 'npm:zod@4.6.7';\nimport('npm:zod@4.6.7/mini');",
          },
          {
            path: 'supabase/functions/_shared/sentry.ts',
            text: "const sdk = await import('npm:@sentry/deno@11.8.0');",
          },
          {
            path: 'supabase/functions/deno.json',
            text: '{ "imports": { "zod": "npm:zod@4.6.7" } }',
          },
          { path: 'bunfig.toml', text: 'x = "npm:zod@4.6.7"' },
        ],
        pins,
      ),
    ).toEqual([]);
  });

  it('reports a version different from the root pin', () => {
    expect(
      findNpmPinProblems(
        [
          {
            path: 'supabase/functions/deno.json',
            text: '{ "imports": { "zod": "npm:zod@4.6.6" } }',
          },
        ],
        pins,
      ),
    ).toEqual([
      'supabase/functions/deno.json: "npm:zod@4.6.6" does not match the root package.json pin "4.6.7"; change the specifier to "npm:zod@4.6.7" (or update the pin and every specifier together)',
    ]);
  });

  it('reports a specifier without a version', () => {
    expect(
      findNpmPinProblems(
        [
          {
            path: 'supabase/functions/a/index.ts',
            text: 'import { z } from "npm:zod";',
          },
          {
            path: 'supabase/functions/a/sdk.ts',
            text: 'import "npm:@sentry/deno/build";',
          },
        ],
        pins,
      ),
    ).toEqual([
      'supabase/functions/a/index.ts: "npm:zod" has no version; write "npm:zod@4.6.7"',
      'supabase/functions/a/sdk.ts: "npm:@sentry/deno/build" has no version; write "npm:@sentry/deno@11.8.0/build"',
    ]);
  });

  it('reports a package that is not a root devDependency', () => {
    expect(
      findNpmPinProblems(
        [
          {
            path: 'supabase/functions/a/index.ts',
            text: "import x from 'npm:left-pad@1.3.0';",
          },
        ],
        pins,
      ),
    ).toEqual([
      'supabase/functions/a/index.ts: "npm:left-pad@1.3.0" is not an exact devDependency in the root package.json; add "left-pad": "1.3.0" there (Deno resolves npm: imports from the root node_modules)',
    ]);
  });

  it('reports a root pin that is a range, once per package', () => {
    expect(
      findNpmPinProblems(
        [
          {
            path: 'supabase/functions/a.ts',
            text: "import 'npm:zod@4.6.7'; import 'npm:zod@4.6.7/mini';",
          },
        ],
        { zod: '^4.6.7' },
      ),
    ).toEqual([
      'package.json: devDependency "zod" is "^4.6.7", used by an Edge Function through npm:; pin it to an exact version',
    ]);
  });

  it('ignores prose mentions, comments, and packages that are not pinned in a string', () => {
    expect(
      findNpmPinProblems(
        [
          {
            path: 'supabase/functions/_shared/sentry.ts',
            text: [
              '/** The subset of `npm:@sentry/deno` this helper uses. */',
              '// import "npm:zod"',
              "throw new Error('cannot resolve npm:@sentry/deno');",
            ].join('\n'),
          },
        ],
        pins,
      ),
    ).toEqual([]);
  });

  it('scans only the Edge Function sources, deno config files, and bunfig.toml', () => {
    const repoFiles = [
      'supabase/functions/a/index.ts',
      'supabase/functions/a/view.tsx',
      'supabase/functions/deno.json',
      'supabase/functions/deno.jsonc',
      'supabase/functions/deno.lock',
      'supabase/functions/README.md',
      'supabase/queries/a.ts',
      'apps/admin-web/src/a.ts',
      'bunfig.toml',
      'apps/frontend/bunfig.toml',
    ];
    const read = (file: string) => `text of ${file}`;
    expect(collectNpmPinFiles(repoFiles, read).map((f) => f.path)).toEqual([
      'supabase/functions/a/index.ts',
      'supabase/functions/a/view.tsx',
      'supabase/functions/deno.json',
      'supabase/functions/deno.jsonc',
      'bunfig.toml',
    ]);
  });
});

describe('Edge Function npm pins (repository)', () => {
  it('uses only npm: specifiers that match the exact root devDependencies pins', () => {
    const files = collectNpmPinFiles(listRepoFiles(root), (file) =>
      readFileSync(join(root, file), 'utf8'),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(findNpmPinProblems(files, readRootDevDependencies(root))).toEqual(
      [],
    );
  });
});
