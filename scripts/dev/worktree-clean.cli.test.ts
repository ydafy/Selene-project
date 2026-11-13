import { afterAll, beforeAll, describe, expect, it as bunIt } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// Runs the real command against a throwaway repository: a bare origin, a main
// clone, worktrees under <main>-worktrees, and a fake ~/.supabase/stacks (HOME
// and USERPROFILE point at a temp folder). Nothing outside the temp folder is touched.

const SCRIPT = join(import.meta.dir, 'worktree-clean.ts');
// Each test spawns git and the command several times: about 2.5 s alone on
// Windows, past the 5 s default when the full suite runs in parallel (#203).
const REAL_REPO_TIMEOUT_MS = 30_000;
const it = (name: string, fn: () => void) =>
  bunIt(name, fn, REAL_REPO_TIMEOUT_MS);
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
  return cleanWith(env, args);
}

function cleanWith(runEnv: Record<string, string>, args: string[]) {
  const result = Bun.spawnSync(['bun', SCRIPT, ...args], {
    cwd: main,
    env: runEnv,
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

function fakeStack(name: string, projectRoot: string, branch = 'x') {
  const dir = join(home, '.supabase', 'stacks', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      identity: { projectRoot, branchContext: `refs/heads/${branch}` },
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

/**
 * Puts stub `supabase` and `docker` commands first on PATH. Each records its
 * arguments in calls.log; `supabase stack list` prints the given stacks.
 */
function withStubs(stacks: object[]) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  // Each call becomes an empty file named "<order> <arguments>".
  const calls = join(bin, 'calls');
  rmSync(calls, { recursive: true, force: true });
  mkdirSync(calls);
  const list = JSON.stringify({ stacks, message: '' });
  writeFileSync(
    join(bin, 'stub.ts'),
    [
      "import { readdirSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'const args = Bun.argv.slice(2);',
      "const calls = join(import.meta.dir, 'calls');",
      "const order = String(readdirSync(calls).length).padStart(3, '0');",
      "writeFileSync(join(calls, `${order} ${args.join(' ')}`), '');",
      "if (args[1] === 'stack' && args[2] === 'list')",
      `  console.log(${JSON.stringify(list)});`,
    ].join('\n'),
  );
  for (const name of ['supabase', 'docker']) {
    writeFileSync(
      join(bin, name),
      `#!/bin/sh\nexec bun "$(dirname "$0")/stub.ts" ${name} "$@"\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, `${name}.cmd`),
      `@bun "%~dp0stub.ts" ${name} %*\r\n`,
    );
  }
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  return {
    env: { ...env, [pathKey]: `${bin}${delimiter}${env[pathKey]}` },
    calls: () =>
      readdirSync(calls)
        .sort()
        .map((name) => name.slice(4))
        .filter((call) => call.includes(' destroy ')),
  };
}

const listedStack = (
  id: string,
  projectRoot: string,
  branch: string,
  owner = 'unavailable',
) => ({
  id,
  project_root: projectRoot,
  name: 'default',
  branch_context: `refs/heads/${branch}`,
  runtime: 'docker',
  owner,
});

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

  it('destroys only the stacks of deleted or merged branches with --stale-stacks --yes', () => {
    const live = join(`${main}-worktrees`, 'live');
    sh(['git', 'worktree', 'add', '-q', '-b', 'feat/live', live], main);
    commit(live, 'live.md');
    sh(['git', 'branch', 'feat/old-merged', 'origin/main'], main);
    sh(['git', 'branch', 'feat/old-unmerged', 'feat/live'], main);
    const stubs = withStubs([
      listedStack('s-current', live, 'feat/live'),
      listedStack('s-merged', live, 'feat/old-merged'),
      listedStack('s-gone', main, 'feat/gone'),
      listedStack('s-unmerged', main, 'feat/old-unmerged'),
      listedStack('s-running', main, 'feat/gone', 'reachable'),
      listedStack('s-foreign', join(root, 'other-project'), 'feat/gone'),
    ]);
    // On disk only: the CLI could not decode them.
    const oldGone = fakeStack('u-gone', main, 'feat/gone');
    const oldMain = fakeStack('u-main', main, 'main');

    const plan = cleanWith(stubs.env, ['--stale-stacks']);
    expect(plan.code).toBe(0);
    expect(plan.out).toContain('keep s-current feat/live');
    expect(plan.out).toContain('stale s-merged feat/old-merged');
    expect(plan.out).toContain('stale s-gone feat/gone');
    expect(plan.out).toContain('unmerged branch feat/old-unmerged');
    expect(plan.out).toContain('running: stop it first');
    expect(plan.out).not.toContain('s-foreign');
    expect(plan.out).toContain('stale u-gone feat/gone');
    expect(plan.out).toContain('keep u-main main');
    expect(plan.out).toContain('plan only');
    expect(stubs.calls()).toEqual([]);
    expect(existsSync(oldGone)).toBe(true);

    const run = cleanWith(stubs.env, ['--stale-stacks', '--yes']);
    expect(run.out).toContain('[worktree-clean] done');
    expect(run.code).toBe(0);
    expect(stubs.calls()).toEqual([
      'supabase stack destroy --stack-id s-merged --yes',
      'supabase stack destroy --stack-id s-gone --yes',
    ]);
    expect(existsSync(oldGone)).toBe(false);
    expect(existsSync(oldMain)).toBe(true);
  });
});
