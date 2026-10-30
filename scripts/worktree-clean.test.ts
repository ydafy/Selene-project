import { describe, expect, it } from 'bun:test';

import {
  findOrphanStacks,
  findStacksForRoot,
  parseStackIdentity,
  parseWorktrees,
  planWorktreeClean,
  samePath,
  type CleanInput,
  type StackDir,
} from './worktree-clean';

const PORCELAIN = [
  'worktree C:/dev/School-portal',
  'HEAD aaa',
  'branch refs/heads/main',
  '',
  'worktree C:/dev/School-portal-worktrees/auth',
  'HEAD bbb',
  'branch refs/heads/fix/auth',
  '',
  'worktree C:/dev/School-portal-worktrees/spike',
  'HEAD ccc',
  'detached',
  '',
].join('\n');

const stack = (
  dir: string,
  projectRoot: string,
  branch = 'fix/auth',
): StackDir => ({
  dir,
  identity: { projectRoot, branch },
});

const input = (overrides: Partial<CleanInput> = {}): CleanInput => ({
  target: 'C:/dev/School-portal-worktrees/auth',
  currentRoot: 'C:/dev/School-portal',
  worktrees: parseWorktrees(PORCELAIN),
  changedFiles: [],
  untrackedFiles: [],
  branchMerged: true,
  stackDirs: ['C:/Users/me/.supabase/stacks/abc'],
  evidenceFiles: 0,
  ...overrides,
});

describe('parseWorktrees', () => {
  it('reads every worktree with its branch, or null when detached', () => {
    expect(parseWorktrees(PORCELAIN)).toEqual([
      { path: 'C:/dev/School-portal', branch: 'main' },
      { path: 'C:/dev/School-portal-worktrees/auth', branch: 'fix/auth' },
      { path: 'C:/dev/School-portal-worktrees/spike', branch: null },
    ]);
  });
});

describe('samePath', () => {
  it('ignores slash direction, trailing slashes and case', () => {
    expect(
      samePath(
        'C:\\dev\\School-portal-worktrees\\Auth\\',
        'c:/dev/school-portal-worktrees/auth',
      ),
    ).toBe(true);
    expect(samePath('C:/dev/a', 'C:/dev/ab')).toBe(false);
  });
});

describe('parseStackIdentity', () => {
  it('reads the project root and branch the Supabase CLI recorded', () => {
    const json = JSON.stringify({
      identity: {
        projectRoot: 'C:\\dev\\School-portal-worktrees\\auth',
        branchContext: 'refs/heads/fix/auth',
        stackName: 'default',
      },
    });
    expect(parseStackIdentity(json)).toEqual({
      projectRoot: 'C:\\dev\\School-portal-worktrees\\auth',
      branch: 'fix/auth',
    });
  });

  it('returns null for unreadable or unknown state, so nothing unidentified is ever deleted', () => {
    expect(parseStackIdentity('not json')).toBeNull();
    expect(parseStackIdentity(JSON.stringify({ identity: {} }))).toBeNull();
  });
});

describe('findStacksForRoot', () => {
  it('returns every stack of the worktree, whatever branch created it', () => {
    const stacks = [
      stack('s1', 'C:\\dev\\School-portal-worktrees\\auth', 'fix/auth'),
      stack('s2', 'C:\\dev\\School-portal-worktrees\\auth', 'fix/older'),
      stack('s3', 'C:\\dev\\School-portal-worktrees\\other'),
    ];
    expect(
      findStacksForRoot(stacks, 'C:/dev/School-portal-worktrees/auth'),
    ).toEqual(['s1', 's2']);
  });
});

describe('findOrphanStacks', () => {
  it('lists only stacks whose worktree folder no longer exists', () => {
    const stacks = [
      stack('alive', 'C:\\dev\\School-portal-worktrees\\auth'),
      stack('gone', 'C:\\dev\\School-portal-worktrees\\deleted'),
    ];
    const exists = (path: string) =>
      samePath(path, 'C:/dev/School-portal-worktrees/auth');
    expect(findOrphanStacks(stacks, exists)).toEqual([stacks[1]]);
  });
});

describe('planWorktreeClean', () => {
  it('plans every cleanup step, in order, for a merged and clean worktree', () => {
    const plan = planWorktreeClean(input());
    expect(plan.blockers).toEqual([]);
    expect(plan.steps).toEqual([
      'supabase stop (inside the worktree)',
      'git worktree remove C:/dev/School-portal-worktrees/auth',
      'git worktree prune',
      'git branch -d fix/auth',
      'git fetch --prune origin',
      'delete Supabase stack data C:/Users/me/.supabase/stacks/abc',
    ]);
  });

  it('refuses a path that is not a worktree of this repository', () => {
    const plan = planWorktreeClean(input({ target: 'C:/dev/elsewhere' }));
    expect(plan.blockers).toEqual([
      'C:/dev/elsewhere is not a worktree of this repository',
    ]);
    expect(plan.steps).toEqual([]);
  });

  it('refuses the main checkout', () => {
    const plan = planWorktreeClean(input({ target: 'C:/dev/School-portal' }));
    expect(plan.blockers).toEqual([
      'C:/dev/School-portal is the main checkout',
    ]);
  });

  it('refuses uncommitted, untracked and unmerged work and names it', () => {
    const plan = planWorktreeClean(
      input({
        changedFiles: ['src/a.ts'],
        untrackedFiles: ['notes.md'],
        branchMerged: false,
      }),
    );
    expect(plan.blockers).toEqual([
      'uncommitted changes: src/a.ts',
      'untracked files: notes.md',
      'branch fix/auth is not merged into origin/main',
    ]);
  });

  it('refuses to delete the worktree the command runs in', () => {
    const plan = planWorktreeClean(
      input({ currentRoot: 'C:\\dev\\School-portal-worktrees\\auth' }),
    );
    expect(plan.blockers).toEqual([
      'this command runs inside the target worktree: run it from the main checkout',
    ]);
  });

  it('skips the branch step for a detached worktree and warns about verification evidence', () => {
    const plan = planWorktreeClean(
      input({
        target: 'C:/dev/School-portal-worktrees/spike',
        branchMerged: null,
        stackDirs: [],
        evidenceFiles: 3,
      }),
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.steps).not.toContain('git branch -d fix/auth');
    expect(plan.steps.some((s) => s.startsWith('delete Supabase'))).toBe(false);
    expect(plan.warnings).toEqual([
      'verification-evidence/ holds 3 files and is deleted with the folder: copy it first if a PR needs it',
    ]);
  });
});
