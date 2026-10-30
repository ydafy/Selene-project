import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs the real command against a throwaway repository: a bare origin, a main
// clone, worktrees under <main>-worktrees, and a fake ~/.supabase/stacks (HOME
// and USERPROFILE point at a temp folder). Nothing outside the temp folder is touched.

const SCRIPT = join(import.meta.dir, 'worktree-clean.ts');
let root = '';
let main = '';
let home = '';
let env: Record<string, string> = {};

function sh(cmd: string[], cwd: string) {
  const result = Bun.spawnSync(cmd, {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0)
    throw new Error(`${cmd.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function clean(...args: string[]) {
  const result = Bun.spawnSync(['bun', SCRIPT, ...args], {
    cwd: main,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode,
    out: result.stdout.toString() + result.stderr.toString(),
  };
}

function commit(cwd: string, file: string) {
  writeFileSync(join(cwd, file), file);
  sh(['git', 'add', file], cwd);
  sh(['git', 'commit', '-q', '-m', file], cwd);
}

function fakeStack(name: string, projectRoot: string) {
  const dir = join(home, '.supabase', 'stacks', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      identity: { projectRoot, branchContext: 'refs/heads/x' },
    }),
  );
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'worktree-clean-'));
  home = join(root, 'home');
  mkdirSync(home);
  // Drop every inherited GIT_* variable: inside a git hook GIT_DIR and
  // GIT_INDEX_FILE point at the real repository, and git would act on it.
  const inherited = Object.entries(process.env).filter(
    ([key, value]) => !key.startsWith('GIT_') && value !== undefined,
  ) as [string, string][];
  env = {
    ...Object.fromEntries(inherited),
    HOME: home,
    USERPROFILE: home,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
  };
  writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  sh(['git', 'init', '-q', '--bare', '-b', 'main', 'origin.git'], root);
  sh(['git', 'clone', '-q', 'origin.git', 'repo'], root);
  main = join(root, 'repo');
  commit(main, 'readme.md');
  sh(['git', 'push', '-q', 'origin', 'HEAD:main'], main);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('worktree:clean against a real repository', () => {
  it('removes a merged worktree, its branch and only the stack data that names it', () => {
    const wt = join(`${main}-worktrees`, 'merged');
    sh(['git', 'worktree', 'add', '-q', '-b', 'feat/merged', wt], main);
    commit(wt, 'feature.md');
    sh(['git', 'merge', '-q', '--ff-only', 'feat/merged'], main);
    sh(['git', 'push', '-q', 'origin', 'HEAD:main'], main);
    const ownStack = fakeStack('own', wt);
    const otherStack = fakeStack('other', join(root, 'somewhere-else'));

    const plan = clean('merged');
    expect(plan.code).toBe(0);
    expect(plan.out).toContain('would run: git branch -D feat/merged');
    expect(existsSync(wt)).toBe(true);

    const run = clean('merged', '--yes');
    expect(run.out).toContain('[worktree-clean] done');
    expect(run.code).toBe(0);
    expect(existsSync(wt)).toBe(false);
    expect(sh(['git', 'branch', '--list', 'feat/merged'], main)).toBe('');
    expect(existsSync(ownStack)).toBe(false);
    expect(existsSync(otherStack)).toBe(true);
  });

  it('deletes a merged branch even when its upstream is behind it', () => {
    const wt = join(`${main}-worktrees`, 'upstream');
    sh(['git', 'worktree', 'add', '-q', '-b', 'feat/upstream', wt], main);
    sh(['git', 'push', '-q', '-u', 'origin', 'feat/upstream'], wt);
    commit(wt, 'upstream.md');
    sh(['git', 'merge', '-q', '--ff-only', 'feat/upstream'], main);
    sh(['git', 'push', '-q', 'origin', 'HEAD:main'], main);

    const run = clean('upstream', '--yes');
    expect(run.out).toContain('[worktree-clean] done');
    expect(run.code).toBe(0);
    expect(sh(['git', 'branch', '--list', 'feat/upstream'], main)).toBe('');
  });

  it('removes a worktree whose ignored files have paths longer than 260 characters', () => {
    writeFileSync(join(main, '.gitignore'), 'node_modules/\n');
    sh(['git', 'add', '.gitignore'], main);
    sh(['git', 'commit', '-q', '-m', 'ignore node_modules'], main);
    sh(['git', 'push', '-q', 'origin', 'HEAD:main'], main);
    const wt = join(`${main}-worktrees`, 'deep');
    sh(['git', 'worktree', 'add', '-q', '-b', 'feat/deep', wt], main);
    const deep = join(
      wt,
      'node_modules',
      ...Array(12).fill('a-long-package-name-x'),
    );
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'index.js'), '');
    expect(join(deep, 'index.js').length).toBeGreaterThan(260);

    const run = clean('deep', '--yes');
    expect(run.out).toContain('[worktree-clean] done');
    expect(run.code).toBe(0);
    expect(existsSync(wt)).toBe(false);
    expect(sh(['git', 'branch', '--list', 'feat/deep'], main)).toBe('');
  });

  it('keeps a detached worktree whose commits are not in origin/main', () => {
    const wt = join(`${main}-worktrees`, 'spike');
    sh(['git', 'worktree', 'add', '-q', '--detach', wt], main);
    commit(wt, 'spike.md');

    const run = clean('spike', '--yes');
    expect(run.code).toBe(1);
    expect(run.out).toContain(
      'blocked: detached HEAD is not merged into origin/main',
    );
    expect(existsSync(join(wt, 'spike.md'))).toBe(true);
  });

  it('deletes orphan stack data of this repository only', () => {
    const orphan = fakeStack('orphan', join(`${main}-worktrees`, 'deleted'));
    const foreign = fakeStack('foreign', join(root, 'other-project'));

    const plan = clean('--orphans');
    expect(plan.out).toContain(orphan);
    expect(plan.out).not.toContain(foreign);

    expect(clean('--orphans', '--yes').code).toBe(0);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(foreign)).toBe(true);
  });
});
