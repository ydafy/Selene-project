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

function gitRepo(): { cwd: string; toplevel: string } {
  const cwd = tempDir('codegraph-refresh-repo-');
  Bun.spawnSync(['git', 'init', '-q'], { cwd });
  const toplevel = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
    cwd,
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
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key.toUpperCase() !== 'PATH') env[key] = value;
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
