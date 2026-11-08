import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  ENV_FILES,
  copyWorktreeEnv,
  mainWorktreeFromPorcelain,
} from './worktree-env';

const roots: string[] = [];

function makeRoot(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'worktree-env-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('ENV_FILES', () => {
  it('lists the three maintainer-owned env files', () => {
    expect(ENV_FILES).toEqual([
      'apps/frontend/.env',
      'apps/admin-web/.env',
      'supabase/functions/.env',
    ]);
  });
});

describe('mainWorktreeFromPorcelain', () => {
  it('returns the first worktree, which git always lists as the main checkout', () => {
    const porcelain = [
      'worktree C:/dev/School-portal',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree C:/dev/School-portal-worktrees/auth',
      'HEAD def',
      'branch refs/heads/audit/auth-sessions',
      '',
    ].join('\n');

    expect(mainWorktreeFromPorcelain(porcelain)).toBe('C:/dev/School-portal');
  });

  it('returns null when the output has no worktree entry', () => {
    expect(mainWorktreeFromPorcelain('')).toBeNull();
  });
});

describe('copyWorktreeEnv', () => {
  it('copies every env file the main checkout has into a fresh worktree', () => {
    const main = makeRoot({
      'apps/frontend/.env': 'FRONTEND=1\n',
      'apps/admin-web/.env': 'ADMIN=1\n',
      'supabase/functions/.env': 'FUNCTIONS=1\n',
    });
    const target = makeRoot();

    const results = copyWorktreeEnv({ mainRoot: main, targetRoot: target });

    expect(results).toEqual([
      { file: 'apps/frontend/.env', outcome: 'copied' },
      { file: 'apps/admin-web/.env', outcome: 'copied' },
      { file: 'supabase/functions/.env', outcome: 'copied' },
    ]);
    expect(readFileSync(join(target, 'apps/frontend/.env'), 'utf8')).toBe(
      'FRONTEND=1\n',
    );
    expect(readFileSync(join(target, 'apps/admin-web/.env'), 'utf8')).toBe(
      'ADMIN=1\n',
    );
    expect(readFileSync(join(target, 'supabase/functions/.env'), 'utf8')).toBe(
      'FUNCTIONS=1\n',
    );
  });

  it('never overwrites an env file the worktree already has', () => {
    const main = makeRoot({ 'supabase/functions/.env': 'FROM_MAIN=1\n' });
    const target = makeRoot({ 'supabase/functions/.env': 'LOCAL_EDIT=1\n' });

    const results = copyWorktreeEnv({ mainRoot: main, targetRoot: target });

    expect(results).toContainEqual({
      file: 'supabase/functions/.env',
      outcome: 'kept-existing',
    });
    expect(readFileSync(join(target, 'supabase/functions/.env'), 'utf8')).toBe(
      'LOCAL_EDIT=1\n',
    );
  });

  it('overwrites only when forced', () => {
    const main = makeRoot({ 'supabase/functions/.env': 'FROM_MAIN=1\n' });
    const target = makeRoot({ 'supabase/functions/.env': 'LOCAL_EDIT=1\n' });

    const results = copyWorktreeEnv({
      mainRoot: main,
      targetRoot: target,
      force: true,
    });

    expect(results).toContainEqual({
      file: 'supabase/functions/.env',
      outcome: 'copied',
    });
    expect(readFileSync(join(target, 'supabase/functions/.env'), 'utf8')).toBe(
      'FROM_MAIN=1\n',
    );
  });

  it('skips files the main checkout does not have and creates nothing for them', () => {
    const main = makeRoot({ 'apps/frontend/.env': 'FRONTEND=1\n' });
    const target = makeRoot();

    const results = copyWorktreeEnv({ mainRoot: main, targetRoot: target });

    expect(results).toContainEqual({
      file: 'apps/admin-web/.env',
      outcome: 'missing-in-main',
    });
    expect(existsSync(join(target, 'apps/admin-web/.env'))).toBe(false);
  });

  it('does nothing when the target is the main checkout itself', () => {
    const main = makeRoot({ 'apps/frontend/.env': 'FRONTEND=1\n' });

    expect(copyWorktreeEnv({ mainRoot: main, targetRoot: main })).toEqual([]);
  });
});
