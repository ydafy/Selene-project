import { describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  checkLineBudget,
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
  'odd/tasks/auth-hardening.md',
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

  it('reports a path cited in a docs subfolder that does not exist', () => {
    expect(
      check(
        'docs/formal/x/README.md',
        'See `docs/go-live.md` and `supabase/missing.sql`.',
      ),
    ).toEqual([
      'docs/formal/x/README.md: path `supabase/missing.sql` does not exist',
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

  it('resolves a ./ or ../ path only from the citing file', () => {
    const text = [
      '[a](../go-live.md), [b](../../odd/tasks/auth-hardening.md),',
      '[c](../odd/tasks/auth-hardening.md), `./nope.md`',
    ].join('\n');
    expect(check('docs/specs/auth.md', text)).toEqual([
      'docs/specs/auth.md: path `./nope.md` does not exist',
      'docs/specs/auth.md: path `../odd/tasks/auth-hardening.md` does not exist',
    ]);
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

  it('skips an app route but checks a slash path into the repository', () => {
    expect(
      check(
        'docs/go-live.md',
        'Open `/privacidad`, `/signup`, or `/docs/nope.md`.',
      ),
    ).toEqual(['docs/go-live.md: path `/docs/nope.md` does not exist']);
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

  it('collects every Markdown file of our own skills, not vendor ones', () => {
    const fake = mkdtempSync(join(tmpdir(), 'agent-instructions-'));
    try {
      const files = [
        '.agents/skills/own/SKILL.md',
        '.agents/skills/own/features/x.md',
        '.agents/skills/own/features/y.bru',
        '.agents/skills/vendor/SKILL.md',
        '.agents/skills/vendor/references/z.md',
      ];
      writeFileSync(
        join(fake, 'skills-lock.json'),
        JSON.stringify({ skills: { vendor: {} } }),
      );
      for (const file of files) {
        mkdirSync(dirname(join(fake, file)), { recursive: true });
        writeFileSync(join(fake, file), 'text');
      }
      expect(
        collectInstructionFiles(fake, files).map((file) => file.path),
      ).toEqual([
        '.agents/skills/own/SKILL.md',
        '.agents/skills/own/features/x.md',
      ]);
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });

  it('collects every Markdown file under docs, subfolders included', () => {
    const fake = mkdtempSync(join(tmpdir(), 'agent-instructions-'));
    try {
      const files = [
        'docs/go-live.md',
        'docs/formal/x/README.md',
        'docs/formal/x/model.tla',
        'README.md',
      ];
      writeFileSync(
        join(fake, 'skills-lock.json'),
        JSON.stringify({ skills: {} }),
      );
      for (const file of files) {
        mkdirSync(dirname(join(fake, file)), { recursive: true });
        writeFileSync(join(fake, file), 'text');
      }
      expect(
        collectInstructionFiles(fake, files).map((file) => file.path),
      ).toEqual(['docs/formal/x/README.md', 'docs/go-live.md']);
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });

  it('reads the line budget from the maintainer note', () => {
    expect(readLineBudget('Keep it at most 170 lines (checked)')).toBe(170);
    expect(readLineBudget('Keep it short.')).toBeUndefined();
  });

  it('reports a file over its line budget', () => {
    expect(checkLineBudget('Keep it at most 3 lines\nb\nc\nd\n')).toBe(
      '4 lines, over the budget of 3',
    );
  });

  it('accepts a file at its line budget', () => {
    expect(checkLineBudget('Keep it at most 3 lines\nb\nc\n')).toBeUndefined();
  });

  it('reports a missing budget note', () => {
    expect(checkLineBudget('Keep it short.\n')).toBe(
      'no "Keep it at most N lines" note',
    );
  });

  it('reports a budget over the 200-line maximum', () => {
    expect(checkLineBudget('Keep it at most 201 lines\n')).toBe(
      'the budget of 201 lines is over the 200-line maximum',
    );
  });

  it('counts lines without the trailing newline', () => {
    expect(countLines('a\r\nb\n')).toBe(2);
  });
});

describe('agent instruction references (repository)', () => {
  const files = collectInstructionFiles(root, listRepoFiles(root));

  it('covers every AGENTS.md file, every local skill, and every docs file', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain('docs/go-live.md');
    expect(paths).toContain(
      'docs/formal/shipment-transfer-cancellation/README.md',
    );
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
    expect(checkLineBudget(text)).toBeUndefined();
  });
});
