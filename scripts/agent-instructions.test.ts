import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  collectInstructionFiles,
  countLines,
  extractPathReferences,
  extractScriptReferences,
  findBrokenReferences,
  findStaleAllowlistEntries,
  listRepoFiles,
  NOT_IN_REPO,
  readLineBudget,
  readWorkspaceScripts,
  type InstructionFile,
} from './agent-instructions';

const root = join(import.meta.dir, '..');

// Probes: a small fake repository proves each check can fail.
const repoFiles = [
  'AGENTS.md',
  'docs/go-live.md',
  'apps/frontend/AGENTS.md',
  'apps/frontend/src/shared/theme/index.ts',
  'apps/frontend/src/shared/i18n/en-locale-parity.test.ts',
  'bruno/auth/login-buyer.bru',
];
const scripts = new Map([
  ['', new Set(['lint', 'api:test'])],
  ['@selene/frontend', new Set(['typecheck'])],
]);
const check = (path: string, text: string) =>
  findBrokenReferences({
    files: [{ path, text }],
    repoFiles,
    scripts,
    notInRepo: { '~/.supabase/stacks': 'per-user CLI state' },
  });

describe('agent instruction references (probes)', () => {
  it('reports a cited path that does not exist', () => {
    expect(check('AGENTS.md', 'Read `docs/missing.md`.')).toEqual([
      'AGENTS.md: path `docs/missing.md` does not exist',
    ]);
  });

  it('reports a cited script that no package.json defines', () => {
    expect(check('AGENTS.md', 'Run `bun run fake:script`.')).toEqual([
      'AGENTS.md: script `fake:script` is not in the root package.json',
    ]);
  });

  it('reports a script missing from the filtered workspace', () => {
    expect(
      check('AGENTS.md', '`bun run --filter @selene/frontend lint`'),
    ).toEqual([
      'AGENTS.md: script `lint` is not in the @selene/frontend package.json',
    ]);
  });

  it('reports a path git does not see, such as a gitignored file', () => {
    expect(check('AGENTS.md', 'Edit `bruno/.env`.')).toEqual([
      'AGENTS.md: path `bruno/.env` does not exist',
    ]);
  });

  it('reports a glob that matches no file', () => {
    expect(check('AGENTS.md', '`apps/frontend/src/*.missing.ts`')).toEqual([
      'AGENTS.md: path `apps/frontend/src/*.missing.ts` does not exist',
    ]);
  });

  it('accepts existing paths, directories, globs, and scripts', () => {
    const text = [
      '`docs/go-live.md`, `apps/frontend/`, `bun run lint`,',
      '`bun run --filter @selene/frontend typecheck`, `bun run api:test`.',
    ].join('\n');
    expect(check('AGENTS.md', text)).toEqual([]);
  });

  it('resolves paths relative to the citing file and to the Bruno collection', () => {
    const text =
      '`src/shared/theme/index.ts`, `src/shared/i18n/*locale-parity.test.ts`, `auth/login-buyer.bru`';
    expect(check('apps/frontend/AGENTS.md', text)).toEqual([]);
  });

  it('skips placeholders, URLs, packages, bare extensions, and listed paths', () => {
    const text = [
      '`odd/tasks/<feature>.md`, `https://docs.envia.com/llms.txt`,',
      '`@usebruno/cli@4.2.1`, `.bru`, `~/.supabase/stacks`, `bun run --filter <package> typecheck`',
    ].join('\n');
    expect(check('AGENTS.md', text)).toEqual([]);
  });

  it('checks paths inside commands only when they start at a top-level entry', () => {
    expect(
      check('AGENTS.md', '`deno check docs/nope.ts` and `gh api repos/x/y`'),
    ).toEqual(['AGENTS.md: path `docs/nope.ts` does not exist']);
  });

  it('strips sentence punctuation from a cited path', () => {
    expect(extractPathReferences('See `docs/go-live.md`.')).toEqual([
      'docs/go-live.md',
    ]);
  });

  it('reads scripts with and without a workspace filter', () => {
    expect(
      extractScriptReferences(
        'bun run lint. `bun run --filter @selene/frontend typecheck`',
      ),
    ).toEqual([
      { workspace: '', script: 'lint' },
      { workspace: '@selene/frontend', script: 'typecheck' },
    ]);
  });

  it('reports an allowlist entry no file cites anymore', () => {
    const files: InstructionFile[] = [{ path: 'AGENTS.md', text: 'none' }];
    expect(
      findStaleAllowlistEntries(files, { 'Costos/': 'maintainer vault' }),
    ).toEqual(['Costos/']);
  });

  it('reads the line budget from the maintainer note', () => {
    expect(readLineBudget('Keep it at most 170 lines (checked)')).toBe(170);
    expect(readLineBudget('Keep it short.')).toBeUndefined();
  });

  it('fails a file over its line budget', () => {
    const text = 'Keep it at most 3 lines\nb\nc\nd\n';
    expect(countLines(text)).toBeGreaterThan(readLineBudget(text)!);
  });

  it('counts lines without the trailing newline', () => {
    expect(countLines('a\r\nb\n')).toBe(2);
  });
});

describe('agent instruction references (repository)', () => {
  const files = collectInstructionFiles(root, listRepoFiles(root));

  it('covers every AGENTS.md file and every local skill', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain('AGENTS.md');
    expect(paths).toContain('supabase/functions/AGENTS.md');
    expect(paths).toContain('.agents/skills/verify-selene/SKILL.md');
    expect(paths).not.toContain('.agents/skills/supabase/SKILL.md');
  });

  it('cites only paths and scripts that exist', () => {
    expect(
      findBrokenReferences({
        files,
        repoFiles: listRepoFiles(root),
        scripts: readWorkspaceScripts(root),
        notInRepo: NOT_IN_REPO,
      }),
    ).toEqual([]);
  });

  it('keeps every allowlisted path cited', () => {
    expect(findStaleAllowlistEntries(files, NOT_IN_REPO)).toEqual([]);
  });

  it('keeps the root AGENTS.md within its line budget', () => {
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const budget = readLineBudget(text);
    expect(budget).toBeDefined();
    // Anthropic's guidance for always-loaded instruction files.
    expect(budget!).toBeLessThanOrEqual(200);
    expect(countLines(text)).toBeLessThanOrEqual(budget!);
  });
});
