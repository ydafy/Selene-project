import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { listRepoFiles } from './agent-instructions';
import {
  collectScriptSources,
  findBrokenScriptPaths,
  findStaleScriptAllowlist,
  SCRIPT_PATHS_NOT_IN_REPO,
  type ScriptSource,
} from './script-paths';

const root = join(import.meta.dir, '..');

const repoFiles = [
  'package.json',
  'scripts/check-commit-msg.ts',
  'scripts/worktree-env.ts',
  'apps/frontend/package.json',
  'apps/frontend/app.json',
  'docker-compose.postgres-test.yml',
];

const source = (
  command: string,
  label = 'package.json script "probe"',
  directory = '',
): ScriptSource => ({ label, directory, command });

const broken = (sources: ScriptSource[], notInRepo = {}) =>
  findBrokenScriptPaths({ sources, repoFiles, notInRepo });

describe('script paths (probes)', () => {
  it('reports a package.json script that runs a missing file', () => {
    expect(broken([source('bun scripts/clean-all.ts')])).toEqual([
      'package.json script "probe": `scripts/clean-all.ts` does not exist',
    ]);
  });

  it('reports a hook path resolved next to the hook that does not exist', () => {
    expect(
      broken([
        source(
          'bun "$(dirname "$0")/../scripts/worktree-env-old.ts" || true',
          '.husky/post-checkout',
        ),
      ]),
    ).toEqual([
      '.husky/post-checkout: `scripts/worktree-env-old.ts` does not exist',
    ]);
  });

  it('reports a cd into a missing folder', () => {
    expect(broken([source('cd apps/mobile && bun run start')])).toEqual([
      'package.json script "probe": `apps/mobile` does not exist',
    ]);
  });

  it('resolves paths from the workspace folder and after a cd', () => {
    expect(
      broken([
        source('bun "$(dirname "$0")/../scripts/worktree-env.ts" || true'),
        source('bun scripts/check-commit-msg.ts "$1"', '.husky/commit-msg'),
        source('cd apps/frontend && cat app.json'),
        source(
          'cat app.json',
          'apps/frontend/package.json script "probe"',
          'apps/frontend',
        ),
        source('docker compose -f docker-compose.postgres-test.yml up -d'),
      ]),
    ).toEqual([]);
  });

  it('ignores flags, packages, globs, variables, and the current folder', () => {
    expect(
      broken([
        source('bunx eslint . --ext .js,.jsx,.ts,.tsx'),
        source('bunx @usebruno/cli@4.2.1 run -r --env local'),
        source("bun run --filter '*' typecheck"),
        source('bunx eas-cli build --platform=android'),
        source('lint-staged'),
      ]),
    ).toEqual([]);
  });

  it('accepts an allowlisted path and reports an entry nothing uses', () => {
    const notInRepo = { 'supabase/functions/.env': 'gitignored secrets' };
    const sources = [
      source('supabase functions serve --env-file supabase/functions/.env'),
    ];
    expect(broken(sources, notInRepo)).toEqual([]);
    expect(
      findStaleScriptAllowlist(sources, {
        ...notInRepo,
        'bruno/.env': 'gitignored',
      }),
    ).toEqual(['bruno/.env']);
  });
});

describe('script paths (repository)', () => {
  const sources = collectScriptSources(root);

  it('reads every hook and every package.json script', () => {
    const labels = sources.map((entry) => entry.label);
    expect(labels).toContain('.husky/post-checkout');
    expect(labels).toContain('package.json script "stripe:listen"');
    expect(labels).toContain('apps/admin-web/package.json script "build"');
  });

  it('runs no hook or script path that is missing', () => {
    expect(
      findBrokenScriptPaths({
        sources,
        repoFiles: listRepoFiles(root),
        notInRepo: SCRIPT_PATHS_NOT_IN_REPO,
      }),
    ).toEqual([]);
  });

  it('keeps no allowlist entry that nothing uses', () => {
    expect(findStaleScriptAllowlist(sources, SCRIPT_PATHS_NOT_IN_REPO)).toEqual(
      [],
    );
  });
});
