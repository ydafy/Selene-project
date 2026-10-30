// Removes a finished worktree and everything it left behind: its local Supabase
// stack (stopped, then its data folder under ~/.supabase/stacks), the worktree
// folder and registration, and its merged local branch. Run it from the main
// checkout. Without --yes it only prints the plan.
//
//   bun run worktree:clean <worktree path or folder name>          plan only
//   bun run worktree:clean <worktree path or folder name> --yes    do it
//   bun run worktree:clean --orphans [--yes]   stack data of deleted worktrees
//
// It refuses uncommitted or untracked work, an unmerged branch, the main
// checkout, and the worktree it runs in. Stack data is only deleted when its
// state.json names the worktree, so nothing unidentified is ever removed.
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export interface Worktree {
  path: string;
  branch: string | null;
}

export interface StackIdentity {
  projectRoot: string;
  branch: string | null;
}

export interface StackDir {
  dir: string;
  identity: StackIdentity;
}

export interface CleanInput {
  target: string;
  currentRoot: string;
  worktrees: Worktree[];
  changedFiles: string[];
  untrackedFiles: string[];
  /** null when the worktree is detached and has no branch to delete */
  branchMerged: boolean | null;
  stackDirs: string[];
  evidenceFiles: number;
}

export interface CleanPlan {
  blockers: string[];
  warnings: string[];
  steps: string[];
}

export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines) => {
      const branchLine = lines.find((line) => line.startsWith('branch '));
      return {
        path: lines[0].slice('worktree '.length).trim(),
        branch: branchLine
          ? branchLine.slice('branch refs/heads/'.length).trim()
          : null,
      };
    });
}

const normalize = (path: string) =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Windows paths: slash direction, trailing slashes and case do not matter. */
export const samePath = (a: string, b: string) => normalize(a) === normalize(b);

export function parseStackIdentity(stateJson: string): StackIdentity | null {
  try {
    const identity = JSON.parse(stateJson)?.identity;
    if (
      typeof identity?.projectRoot !== 'string' ||
      identity.projectRoot === ''
    )
      return null;
    const context =
      typeof identity.branchContext === 'string'
        ? identity.branchContext
        : null;
    return {
      projectRoot: identity.projectRoot,
      branch: context ? context.replace(/^refs\/heads\//, '') : null,
    };
  } catch {
    return null;
  }
}

export const findStacksForRoot = (stacks: StackDir[], root: string) =>
  stacks
    .filter((stack) => samePath(stack.identity.projectRoot, root))
    .map((stack) => stack.dir);

export const findOrphanStacks = (
  stacks: StackDir[],
  exists: (path: string) => boolean,
) => stacks.filter((stack) => !exists(stack.identity.projectRoot));

export function planWorktreeClean(input: CleanInput): CleanPlan {
  const worktree = input.worktrees.find((entry) =>
    samePath(entry.path, input.target),
  );
  if (!worktree) {
    return {
      blockers: [`${input.target} is not a worktree of this repository`],
      warnings: [],
      steps: [],
    };
  }
  // git always lists the main checkout first
  if (samePath(input.worktrees[0].path, input.target)) {
    return {
      blockers: [`${input.target} is the main checkout`],
      warnings: [],
      steps: [],
    };
  }

  const blockers: string[] = [];
  if (input.changedFiles.length > 0)
    blockers.push(`uncommitted changes: ${input.changedFiles.join(', ')}`);
  if (input.untrackedFiles.length > 0)
    blockers.push(`untracked files: ${input.untrackedFiles.join(', ')}`);
  if (worktree.branch && input.branchMerged === false)
    blockers.push(`branch ${worktree.branch} is not merged into origin/main`);
  if (samePath(input.currentRoot, input.target))
    blockers.push(
      'this command runs inside the target worktree: run it from the main checkout',
    );

  const warnings =
    input.evidenceFiles > 0
      ? [
          `verification-evidence/ holds ${input.evidenceFiles} files and is deleted with the folder: copy it first if a PR needs it`,
        ]
      : [];

  const steps = [
    'supabase stop (inside the worktree)',
    `git worktree remove ${worktree.path}`,
    'git worktree prune',
    ...(worktree.branch ? [`git branch -d ${worktree.branch}`] : []),
    'git fetch --prune origin',
    ...input.stackDirs.map((dir) => `delete Supabase stack data ${dir}`),
  ];
  return { blockers, warnings, steps };
}

// ---------------------------------------------------------------------------
// Command line: everything below touches git, the Supabase CLI and the disk.

const STACKS_DIR = join(homedir(), '.supabase', 'stacks');

function run(cmd: string[], cwd?: string) {
  const result = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  return {
    ok: result.exitCode === 0,
    out: result.stdout.toString().trim(),
    err: result.stderr.toString().trim(),
  };
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

function readStacks(): StackDir[] {
  if (!existsSync(STACKS_DIR)) return [];
  return readdirSync(STACKS_DIR).flatMap((name) => {
    const dir = join(STACKS_DIR, name);
    const state = join(dir, 'state.json');
    if (!existsSync(state)) return [];
    const identity = parseStackIdentity(readFileSync(state, 'utf8'));
    return identity ? [{ dir, identity }] : [];
  });
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((total, name) => {
    const path = join(dir, name);
    return total + (statSync(path).isDirectory() ? countFiles(path) : 1);
  }, 0);
}

function cleanOrphans(apply: boolean) {
  const orphans = findOrphanStacks(readStacks(), existsSync);
  if (orphans.length === 0) {
    console.log('[worktree-clean] no orphan Supabase stack data');
    return 0;
  }
  for (const { dir, identity } of orphans) {
    console.log(
      `[worktree-clean] orphan: ${dir} (was ${identity.projectRoot}, ${identity.branch ?? 'no branch'})`,
    );
    if (apply) rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    apply
      ? `[worktree-clean] deleted ${orphans.length}`
      : '[worktree-clean] plan only: add --yes to delete them',
  );
  return 0;
}

function cleanWorktree(arg: string, apply: boolean) {
  run(['git', 'fetch', '-q', 'origin']);
  const worktrees = parseWorktrees(
    run(['git', 'worktree', 'list', '--porcelain']).out,
  );
  const match = worktrees.find(
    (entry) => samePath(entry.path, arg) || basename(entry.path) === arg,
  );
  const target = match?.path ?? arg;
  const present = Boolean(match) && existsSync(target);

  const plan = planWorktreeClean({
    target,
    currentRoot: run(['git', 'rev-parse', '--show-toplevel']).out,
    worktrees,
    changedFiles: present
      ? lines(run(['git', 'diff', 'HEAD', '--name-only'], target).out)
      : [],
    untrackedFiles: present
      ? lines(
          run(['git', 'ls-files', '--others', '--exclude-standard'], target)
            .out,
        )
      : [],
    branchMerged: match?.branch
      ? run([
          'git',
          'merge-base',
          '--is-ancestor',
          `refs/heads/${match.branch}`,
          'origin/main',
        ]).ok
      : null,
    stackDirs: findStacksForRoot(readStacks(), target),
    evidenceFiles: present
      ? countFiles(join(target, 'verification-evidence'))
      : 0,
  });

  for (const blocker of plan.blockers)
    console.log(`[worktree-clean] blocked: ${blocker}`);
  for (const warning of plan.warnings)
    console.log(`[worktree-clean] warning: ${warning}`);
  if (plan.blockers.length > 0) return 1;
  for (const step of plan.steps)
    console.log(`[worktree-clean] ${apply ? 'step' : 'would run'}: ${step}`);
  if (!apply) {
    console.log('[worktree-clean] plan only: add --yes to run it');
    return 0;
  }

  if (present) run(['supabase', 'stop'], target); // no stack running is fine
  const removed = present
    ? run(['git', 'worktree', 'remove', '--force', target]) // only line-ending noise is left
    : { ok: true, out: '', err: '' };
  if (!removed.ok) {
    console.error(
      `[worktree-clean] git worktree remove failed: ${removed.err}`,
    );
    console.error(
      '[worktree-clean] close terminals and editors in that folder (or restart Docker Desktop), delete it by hand, then rerun this command',
    );
    return 1;
  }
  run(['git', 'worktree', 'prune']);
  if (match?.branch) {
    const branch = run(['git', 'branch', '-d', match.branch]);
    if (!branch.ok)
      console.error(
        `[worktree-clean] git branch -d ${match.branch}: ${branch.err}`,
      );
  }
  run(['git', 'fetch', '-q', '--prune', 'origin']);
  for (const dir of findStacksForRoot(readStacks(), target))
    rmSync(dir, { recursive: true, force: true });
  console.log('[worktree-clean] done');
  return 0;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const apply = args.includes('--yes');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (args.includes('--orphans')) process.exit(cleanOrphans(apply));
  if (positional.length !== 1) {
    console.error(
      'usage: bun run worktree:clean <worktree path or folder name> [--yes] | --orphans [--yes]',
    );
    process.exit(2);
  }
  process.exit(cleanWorktree(positional[0], apply));
}
