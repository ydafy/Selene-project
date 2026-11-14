import { describe, expect, it } from 'bun:test';

import {
  findOrphanStacks,
  findStacksForRoot,
  isCodegraphHello,
  leftoverAdminDir,
  parseDaemonLock,
  parseStackIdentity,
  orphanScopes,
  parseArgs,
  parseStackList,
  parseWorktrees,
  planStaleStacks,
  planWorktreeClean,
  samePath,
  type BranchState,
  type CleanInput,
  type ListedStack,
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

const DETACHED_UNMERGED = 'detached HEAD is not merged into origin/main';

const input = (overrides: Partial<CleanInput> = {}): CleanInput => ({
  target: 'C:/dev/School-portal-worktrees/auth',
  currentRoot: 'C:/dev/School-portal',
  worktrees: parseWorktrees(PORCELAIN),
  changedFiles: [],
  untrackedFiles: [],
  headMerged: true,
  stackDirs: ['C:/Users/me/.supabase/stacks/abc'],
  evidenceFiles: 0,
  ...overrides,
});

describe('parseWorktrees', () => {
  it('reads every worktree with its branch, or null when detached', () => {
    expect(parseWorktrees(PORCELAIN)).toMatchObject([
      { path: 'C:/dev/School-portal', branch: 'main' },
      { path: 'C:/dev/School-portal-worktrees/auth', branch: 'fix/auth' },
      { path: 'C:/dev/School-portal-worktrees/spike', branch: null },
    ]);
    const heads = parseWorktrees(PORCELAIN).map((w) => w.head);
    expect(heads).toEqual(['aaa', 'bbb', 'ccc']);
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

describe('orphanScopes', () => {
  it('covers only the main checkout and its -worktrees folder', () => {
    expect(orphanScopes('C:/dev/School-portal')).toEqual([
      'C:/dev/School-portal',
      'C:/dev/School-portal-worktrees',
    ]);
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
    const scopes = ['C:/dev/School-portal-worktrees'];
    expect(findOrphanStacks(stacks, exists, scopes)).toEqual([stacks[1]]);
  });

  it('never lists stacks of other projects, even when their folder is gone', () => {
    const stacks = [
      stack('other', 'C:\\dev\\another-app'),
      stack('lookalike', 'C:\\dev\\School-portal-worktrees-old\\x'),
      stack('ours', 'C:\\dev\\School-portal-worktrees\\gone'),
    ];
    const scopes = ['C:/dev/School-portal', 'C:/dev/School-portal-worktrees'];
    expect(findOrphanStacks(stacks, () => false, scopes)).toEqual([stacks[2]]);
  });
});

describe('parseArgs', () => {
  it('reads one worktree or the orphans mode, and rejects every other combination', () => {
    const worktree = { mode: 'worktree', target: 'auth' } as const;
    expect(parseArgs(['auth'])).toEqual({ ...worktree, apply: false });
    expect(parseArgs(['auth', '--yes'])).toEqual({ ...worktree, apply: true });
    const orphans = { mode: 'orphans', apply: true } as const;
    expect(parseArgs(['--orphans', '--yes'])).toEqual(orphans);
    const stale = { mode: 'stale-stacks', apply: false } as const;
    expect(parseArgs(['--stale-stacks'])).toEqual(stale);
    expect(parseArgs(['--stale-stacks', '--orphans'])).toBeNull();
    expect(parseArgs(['auth', '--stale-stacks'])).toBeNull();
    expect(parseArgs(['auth', '--orphans', '--yes'])).toBeNull();
    expect(parseArgs(['auth', '--force'])).toBeNull();
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(['a', 'b'])).toBeNull();
  });
});

describe('planWorktreeClean', () => {
  it('plans every cleanup step, in order, for a merged and clean worktree', () => {
    const plan = planWorktreeClean(input());
    expect(plan.blockers).toEqual([]);
    expect(plan.steps).toEqual([
      'supabase stop (inside the worktree)',
      'stop the CodeGraph daemon of the worktree, if one runs',
      'git worktree remove C:/dev/School-portal-worktrees/auth',
      'git worktree prune',
      'git branch -D fix/auth',
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

  it('plans to finish a removal that git stopped halfway, with a warning', () => {
    const leftover = 'C:/dev/School-portal-worktrees/gone';
    const plan = planWorktreeClean(
      input({
        target: leftover,
        leftover: true,
        headMerged: false,
        changedFiles: null,
        untrackedFiles: null,
        evidenceFiles: 2,
      }),
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.warnings).toEqual([
      `${leftover} is left over from a removal that stopped halfway: git already dropped its registration, so it can no longer check the folder for uncommitted work`,
      'verification-evidence/ holds 2 files and is deleted with the folder: copy it first if a PR needs it',
    ]);
    expect(plan.steps).toEqual([
      'stop the CodeGraph daemon of the worktree, if one runs',
      `delete the leftover folder ${leftover}`,
      'git worktree prune',
      'git fetch --prune origin',
      'delete Supabase stack data C:/Users/me/.supabase/stacks/abc',
    ]);
  });

  it('refuses a leftover target that contains a registered worktree', () => {
    const plan = planWorktreeClean(
      input({ target: 'C:/dev/School-portal-worktrees', leftover: true }),
    );
    expect(plan.blockers).toEqual([
      'C:/dev/School-portal-worktrees contains the worktree C:/dev/School-portal-worktrees/auth',
      'C:/dev/School-portal-worktrees contains the worktree C:/dev/School-portal-worktrees/spike',
    ]);
    expect(plan.steps).toEqual([]);
  });

  it('refuses to delete a leftover folder the command runs in', () => {
    const leftover = 'C:/dev/School-portal-worktrees/gone';
    const plan = planWorktreeClean(
      input({ target: leftover, leftover: true, currentRoot: leftover }),
    );
    expect(plan.blockers).toEqual([
      'this command runs inside the target worktree: run it from the main checkout',
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
        headMerged: false,
      }),
    );
    expect(plan.blockers).toEqual([
      'uncommitted changes: src/a.ts',
      'untracked files: notes.md',
      'branch fix/auth is not merged into origin/main',
    ]);
  });

  it('refuses when git could not read the worktree status, instead of assuming it is clean', () => {
    const plan = planWorktreeClean(input({ changedFiles: null }));
    expect(plan.blockers).toEqual([
      'could not read the git status of C:/dev/School-portal-worktrees/auth',
    ]);
    expect(planWorktreeClean(input({ untrackedFiles: null })).blockers).toEqual(
      plan.blockers,
    );
  });

  it('refuses to delete the worktree the command runs in', () => {
    const plan = planWorktreeClean(
      input({ currentRoot: 'C:\\dev\\School-portal-worktrees\\auth' }),
    );
    expect(plan.blockers).toEqual([
      'this command runs inside the target worktree: run it from the main checkout',
    ]);
  });

  it('refuses a detached worktree whose HEAD has commits outside origin/main', () => {
    const spike = 'C:/dev/School-portal-worktrees/spike';
    const plan = planWorktreeClean(input({ target: spike, headMerged: false }));
    expect(plan.blockers).toEqual([DETACHED_UNMERGED]);
  });

  it('skips the branch step for a detached worktree and warns about verification evidence', () => {
    const plan = planWorktreeClean(
      input({
        target: 'C:/dev/School-portal-worktrees/spike',
        headMerged: true,
        stackDirs: [],
        evidenceFiles: 3,
      }),
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.steps).not.toContain('git branch -D fix/auth');
    expect(plan.steps.some((s) => s.startsWith('delete Supabase'))).toBe(false);
    expect(plan.warnings).toEqual([
      'verification-evidence/ holds 3 files and is deleted with the folder: copy it first if a PR needs it',
    ]);
  });
});

describe('parseStackList', () => {
  it('reads the JSON of supabase stack list, and null when it is not that JSON', () => {
    const json = JSON.stringify({
      stacks: [
        {
          id: 'abc',
          project_root: 'C:\\dev\\School-portal',
          name: 'default',
          branch_context: 'refs/heads/fix/auth',
          runtime: 'docker',
          owner: 'reachable',
        },
        { id: 'def', project_root: 'C:\\x', owner: 'unavailable' },
      ],
      message: '',
    });
    expect(parseStackList(json)).toEqual([
      {
        id: 'abc',
        projectRoot: 'C:\\dev\\School-portal',
        branch: 'fix/auth',
        running: true,
      },
      { id: 'def', projectRoot: 'C:\\x', branch: null, running: false },
    ]);
    expect(parseStackList('NAME | PROJECT')).toBeNull();
    expect(parseStackList('{}')).toBeNull();
  });
});

describe('planStaleStacks', () => {
  const MAIN = 'C:/dev/School-portal';
  const AUTH = 'C:\\dev\\School-portal-worktrees\\auth';
  const listed = (
    id: string,
    projectRoot: string,
    branch: string | null,
    running = false,
  ): ListedStack => ({ id, projectRoot, branch, running });
  const branches: Record<string, BranchState> = {
    main: 'merged',
    'fix/auth': 'unmerged',
    'fix/old': 'merged',
    'fix/gone': 'missing',
    'feat/wip': 'unmerged',
  };
  const plan = (stacks: ListedStack[], undecodable: ListedStack[] = []) =>
    planStaleStacks({
      mainRoot: MAIN,
      worktrees: parseWorktrees(PORCELAIN),
      stacks,
      undecodable,
      branchState: (branch) => branches[branch] ?? 'missing',
    });
  const ids = (decisions: { stack: ListedStack }[]) =>
    decisions.map((d) => d.stack.id);

  it('keeps the stack of every checked-out branch, the main checkout included', () => {
    const result = plan([
      listed('main-current', 'C:\\dev\\School-portal', 'main'),
      listed('auth-current', AUTH, 'fix/auth'),
    ]);
    expect(result.stale).toEqual([]);
    expect(result.kept.map((d) => d.reason)).toEqual([
      'current branch of C:/dev/School-portal',
      'current branch of C:/dev/School-portal-worktrees/auth',
    ]);
  });

  it('marks stacks of deleted or merged branches as stale, in any of our worktrees', () => {
    const result = plan([
      listed('gone', AUTH, 'fix/gone'),
      listed('merged', MAIN, 'fix/old'),
      // main is current only in the main checkout, not in auth
      listed('auth-main', AUTH, 'main'),
    ]);
    expect(result.kept).toEqual([]);
    expect(result.stale.map((d) => [d.stack.id, d.reason])).toEqual([
      ['gone', 'branch deleted'],
      ['merged', 'merged into origin/main'],
      ['auth-main', 'merged into origin/main'],
    ]);
  });

  it('keeps stacks of unmerged branches and stacks without a branch', () => {
    const result = plan([
      listed('wip', AUTH, 'feat/wip'),
      listed('nobranch', AUTH, null),
    ]);
    expect(result.stale).toEqual([]);
    expect(result.kept.map((d) => d.reason)).toEqual([
      'unmerged branch feat/wip',
      'no branch recorded',
    ]);
  });

  it('skips a running stack even when its branch is stale', () => {
    const result = plan([listed('busy', AUTH, 'fix/gone', true)]);
    expect(result.stale).toEqual([]);
    expect(result.kept.map((d) => d.reason)).toEqual([
      'running: stop it first',
    ]);
  });

  it('protects a detached worktree only through the branch rules', () => {
    const spike = 'C:/dev/School-portal-worktrees/spike';
    const result = plan([listed('spike-old', spike, 'fix/old')]);
    expect(ids(result.stale)).toEqual(['spike-old']);
  });

  it('never selects stacks of other projects', () => {
    const result = plan(
      [
        listed('other', 'C:\\dev\\another-app', 'fix/gone'),
        listed(
          'lookalike',
          'C:\\dev\\School-portal-worktrees-old\\x',
          'fix/gone',
        ),
      ],
      [listed('other-old', 'C:\\dev\\another-app', 'fix/gone')],
    );
    expect(result).toEqual({
      stale: [],
      kept: [],
      undecodableStale: [],
      undecodableKept: [],
    });
  });

  it('lists undecodable stacks separately with the same rules', () => {
    const result = plan(
      [listed('readable', MAIN, 'fix/gone')],
      [
        listed('old-gone', MAIN, 'fix/gone'),
        listed('old-main', MAIN, 'main'),
        listed('old-busy', MAIN, 'fix/old', true),
      ],
    );
    expect(ids(result.stale)).toEqual(['readable']);
    expect(ids(result.undecodableStale)).toEqual(['old-gone']);
    expect(result.undecodableKept.map((d) => [d.stack.id, d.reason])).toEqual([
      ['old-main', 'current branch of C:/dev/School-portal'],
      ['old-busy', 'running: stop it first'],
    ]);
  });
});

describe('leftoverAdminDir', () => {
  const common = 'C:/dev/School-portal/.git';

  it('returns the registration folder a worktree .git file points to', () => {
    expect(
      leftoverAdminDir(
        'gitdir: C:/dev/School-portal/.git/worktrees/gone\n',
        common,
      ),
    ).toBe('C:/dev/School-portal/.git/worktrees/gone');
  });

  it('accepts Windows paths and a .. that stays inside .git/worktrees', () => {
    expect(
      leftoverAdminDir(
        'gitdir: c:\\Dev\\school-PORTAL\\.git\\worktrees\\gone\r\n',
        common,
      ),
    ).toBe('c:/Dev/school-PORTAL/.git/worktrees/gone');
    expect(
      leftoverAdminDir(
        'gitdir: C:\\dev\\School-portal\\.git\\worktrees\\tmp\\..\\gone\n',
        common,
      ),
    ).toBe('C:/dev/School-portal/.git/worktrees/gone');
    expect(
      leftoverAdminDir(
        'gitdir: C:/dev/School-portal/.git/worktrees/gone/..\n',
        common,
      ),
    ).toBeNull();
    expect(
      leftoverAdminDir(
        'gitdir: C:/dev/School-portal/.git/worktrees-evil/x\n',
        common,
      ),
    ).toBeNull();
  });

  it('ignores a gitdir nested below a registration folder', () => {
    expect(
      leftoverAdminDir(
        'gitdir: C:/dev/School-portal/.git/worktrees/a/b\n',
        common,
      ),
    ).toBeNull();
  });

  it('ignores a gitdir that escapes .git/worktrees with ..', () => {
    expect(
      leftoverAdminDir(
        'gitdir: C:/dev/School-portal/.git/worktrees/../../../other/.git/worktrees/x\n',
        common,
      ),
    ).toBeNull();
  });

  it('ignores a .git file of another repository or without a gitdir line', () => {
    expect(
      leftoverAdminDir('gitdir: C:/dev/other/.git/worktrees/gone\n', common),
    ).toBeNull();
    expect(leftoverAdminDir('not a git file', common)).toBeNull();
  });
});

describe('parseDaemonLock', () => {
  it('reads the pid and socket of a CodeGraph daemon lock file', () => {
    const lock = JSON.stringify({
      pid: 7652,
      version: '1.6.0',
      socketPath: '\\.\pipe\codegraph-bfb0',
    });
    expect(parseDaemonLock(lock)).toEqual({
      pid: 7652,
      socketPath: '\\.\pipe\codegraph-bfb0',
    });
  });

  it('returns null for an unreadable lock file', () => {
    expect(parseDaemonLock('{')).toBeNull();
    expect(parseDaemonLock('{"pid":"x","socketPath":"p"}')).toBeNull();
  });
});

describe('isCodegraphHello', () => {
  const hello = (pid: number) =>
    JSON.stringify({ codegraph: '1.6.0', pid, socketPath: 'p', protocol: 1 });

  it('accepts only the hello of a CodeGraph daemon with the locked pid', () => {
    expect(isCodegraphHello(hello(7652), 7652)).toBe(true);
    expect(isCodegraphHello(hello(1234), 7652)).toBe(false);
    expect(isCodegraphHello('{"pid":7652}', 7652)).toBe(false);
    expect(isCodegraphHello('garbage', 7652)).toBe(false);
  });
});
