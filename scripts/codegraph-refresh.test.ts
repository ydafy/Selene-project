import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const REFRESH_SCRIPT = join(REPO_ROOT, 'scripts', 'codegraph-refresh.sh');
const HUSKY = join(REPO_ROOT, '.husky');

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function withoutGitVariables(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  return env;
}

function gitRepo(): { cwd: string; toplevel: string } {
  const cwd = tempDir('codegraph-refresh-repo-');
  const env = withoutGitVariables();
  Bun.spawnSync(['git', 'init', '-q'], { cwd, env });
  const toplevel = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
    cwd,
    env,
  })
    .stdout.toString()
    .trim();
  return { cwd, toplevel };
}

function pathWithoutCodegraph(): string {
  const current = process.env.PATH ?? process.env.Path ?? '';
  return current
    .split(delimiter)
    .filter(
      (dir) =>
        dir &&
        !['codegraph', 'codegraph.cmd', 'codegraph.exe'].some((name) =>
          existsSync(join(dir, name)),
        ),
    )
    .join(delimiter);
}

function environment(options: { stub: boolean }) {
  const log = join(tempDir('codegraph-refresh-log-'), 'calls.log');
  const env = withoutGitVariables();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') delete env[key];
  }
  let path = pathWithoutCodegraph();
  if (options.stub) {
    const bin = tempDir('codegraph-refresh-bin-');
    const stub = join(bin, 'codegraph');
    writeFileSync(stub, '#!/bin/sh\necho "$*" >> "$CODEGRAPH_STUB_LOG"\n');
    chmodSync(stub, 0o755);
    path = `${bin}${delimiter}${path}`;
  }
  env.PATH = path;
  env.CODEGRAPH_STUB_LOG = log;
  return { env, log };
}

function run(args: string[], cwd: string, env: Record<string, string>) {
  const result = Bun.spawnSync(['sh', ...args], {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

async function calls(log: string, waitMs: number): Promise<string[]> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (existsSync(log)) break;
    await Bun.sleep(50);
  }
  if (!existsSync(log)) return [];
  await Bun.sleep(50);
  return readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

describe('codegraph-refresh.sh', () => {
  it('builds the index in the background when the worktree has none', async () => {
    const repo = gitRepo();
    const { env, log } = environment({ stub: true });

    const result = run([REFRESH_SCRIPT], repo.cwd, env);

    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(await calls(log, 5_000)).toEqual([`init -y ${repo.toplevel}`]);
  });

  it('syncs an existing index', async () => {
    const repo = gitRepo();
    mkdirSync(join(repo.cwd, '.codegraph'));
    writeFileSync(join(repo.cwd, '.codegraph', 'codegraph.db'), '');
    const { env, log } = environment({ stub: true });

    const result = run([REFRESH_SCRIPT], repo.cwd, env);

    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(await calls(log, 5_000)).toEqual([`sync -q ${repo.toplevel}`]);
  });

  it('builds the index when .codegraph holds only its .gitignore', async () => {
    const repo = gitRepo();
    mkdirSync(join(repo.cwd, '.codegraph'));
    writeFileSync(join(repo.cwd, '.codegraph', '.gitignore'), '*\n');
    const { env, log } = environment({ stub: true });

    run([REFRESH_SCRIPT], repo.cwd, env);

    expect(await calls(log, 5_000)).toEqual([`init -y ${repo.toplevel}`]);
  });

  it('does nothing and stays silent when codegraph is not installed', () => {
    const repo = gitRepo();
    const { env } = environment({ stub: false });

    const result = run([REFRESH_SCRIPT], repo.cwd, env);

    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(existsSync(join(repo.cwd, '.codegraph'))).toBe(false);
  });
});

describe('under a hook from a linked worktree', () => {
  // Git exports GIT_DIR and GIT_INDEX_FILE to the hooks of a linked worktree, and
  // pre-push runs this suite. A git command that inherits them acts on that
  // repository: `git init` there writes core.bare=true into the shared config.
  it('leaves the calling repository untouched', async () => {
    const caller = tempDir('codegraph-refresh-caller-');
    const git = (args: string[], cwd: string) =>
      Bun.spawnSync(['git', ...args], { cwd, env: withoutGitVariables() })
        .stdout.toString()
        .trim();
    git(['init', '-q', '-b', 'main', 'main'], caller);
    const main = join(caller, 'main');
    git(
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'init',
      ],
      main,
    );
    git(['worktree', 'add', '-q', '-b', 'wt', join(caller, 'wt')], main);
    const hookGitDir = git(
      ['rev-parse', '--absolute-git-dir'],
      join(caller, 'wt'),
    );

    // Bun hands a child the environment it started with, so the hook case is a
    // child run of this file's other tests with the hook's variables.
    const child = Bun.spawnSync(
      [
        'bun',
        'test',
        import.meta.path,
        '-t',
        '^(codegraph-refresh.sh|Git hooks)',
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...withoutGitVariables(),
          GIT_DIR: hookGitDir,
          GIT_INDEX_FILE: join(hookGitDir, 'index'),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    expect(child.exitCode).toBe(0);
    expect(git(['config', 'core.bare'], main)).toBe('false');
    expect(git(['config', 'core.bare'], join(caller, 'wt'))).toBe('false');
  }, 30_000);
});

describe('Git hooks refresh the CodeGraph index', () => {
  it.each([
    ['post-checkout', ['aaa', 'bbb', '1']],
    ['post-merge', ['0']],
    ['post-commit', []],
    ['post-rewrite', ['rebase']],
  ])('%s refreshes the index', async (hook, args) => {
    const repo = gitRepo();
    const { env, log } = environment({ stub: true });

    const result = run([join(HUSKY, hook), ...args], repo.cwd, env);

    expect(result.exitCode).toBe(0);
    expect(await calls(log, 5_000)).toEqual([`init -y ${repo.toplevel}`]);
  });

  it('post-checkout skips file checkouts', async () => {
    const repo = gitRepo();
    const { env, log } = environment({ stub: true });

    const result = run(
      [join(HUSKY, 'post-checkout'), 'aaa', 'aaa', '0'],
      repo.cwd,
      env,
    );

    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(await calls(log, 1_000)).toEqual([]);
  });
});
