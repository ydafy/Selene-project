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
  head: string;
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
  /** null when git could not read the worktree: never assume it is clean */
  changedFiles: string[] | null;
  untrackedFiles: string[] | null;
  headMerged: boolean;
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
        head: lines.find((line) => line.startsWith('HEAD '))?.slice(5) ?? '',
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

const isInside = (path: string, dir: string) =>
  normalize(path).startsWith(`${normalize(dir)}/`) || samePath(path, dir);

/**
 * The main checkout and its sibling <main>-worktrees folder (AGENTS.md layout).
 * Stack data anywhere else may belong to another project and is never an orphan here.
 */
export const orphanScopes = (mainRoot: string) => [
  mainRoot,
  `${mainRoot}-worktrees`,
];

export const findOrphanStacks = (
  stacks: StackDir[],
  exists: (path: string) => boolean,
  scopes: string[],
) =>
  stacks.filter(
    (stack) =>
      scopes.some((scope) => isInside(stack.identity.projectRoot, scope)) &&
      !exists(stack.identity.projectRoot),
  );

export function parseArgs(args: string[]) {
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));
  const [target, ...extra] = args.filter((arg) => !arg.startsWith('--'));
  const apply = flags.delete('--yes');
  const orphans = flags.delete('--orphans');
  if (flags.size > 0 || extra.length > 0 || orphans === Boolean(target))
    return null;
  return orphans
    ? { mode: 'orphans' as const, apply }
    : { mode: 'worktree' as const, target, apply };
}

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
  if (input.changedFiles === null || input.untrackedFiles === null)
    blockers.push(`could not read the git status of ${input.target}`);
  if (input.changedFiles?.length)
    blockers.push(`uncommitted changes: ${input.changedFiles.join(', ')}`);
  if (input.untrackedFiles?.length)
    blockers.push(`untracked files: ${input.untrackedFiles.join(', ')}`);
  const head = worktree.branch ? `branch ${worktree.branch}` : 'detached HEAD';
  if (!input.headMerged)
    blockers.push(`${head} is not merged into origin/main`);
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
    ...(worktree.branch ? [`git branch -D ${worktree.branch}`] : []),
    'git fetch --prune origin',
    ...input.stackDirs.map((dir) => `delete Supabase stack data ${dir}`),
  ];
  return { blockers, warnings, steps };
}

// ---------------------------------------------------------------------------
// Command line: everything below touches git, the Supabase CLI and the disk.

const STACKS_DIR = join(homedir(), '.supabase', 'stacks');

function run(cmd: string[], cwd?: string) {
  try {
    const result = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
    return {
      ok: result.exitCode === 0,
      out: result.stdout.toString().trim(),
      err: result.stderr.toString().trim(),
    };
  } catch (error) {
    // e.g. the Supabase CLI is not installed
    return { ok: false, out: '', err: String(error) };
  }
}

/** The lines a read-only git probe printed, or null when it failed. */
function probe(cmd: string[], cwd: string) {
  const result = run(cmd, cwd);
  return result.ok ? lines(result.out) : null;
}

function removeDir(dir: string): string | null {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    return null;
  } catch (error) {
    return `could not delete ${dir}: ${String(error)}`;
  }
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
  const [main] = parseWorktrees(
    run(['git', 'worktree', 'list', '--porcelain']).out,
  );
  if (!main) {
    console.error('[worktree-clean] run it inside this repository');
    return 1;
  }
  const orphans = findOrphanStacks(
    readStacks(),
    existsSync,
    orphanScopes(main.path),
  );
  if (orphans.length === 0) {
    console.log('[worktree-clean] no orphan Supabase stack data');
    return 0;
  }
  const problems: string[] = [];
  for (const { dir, identity } of orphans) {
    console.log(
      `[worktree-clean] orphan: ${dir} (was ${identity.projectRoot}, ${identity.branch ?? 'no branch'})`,
    );
    const problem = apply ? removeDir(dir) : null;
    if (problem) problems.push(problem);
  }
  if (!apply) {
    console.log('[worktree-clean] plan only: add --yes to delete them');
    return 0;
  }
  return finish(problems);
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
      ? probe(['git', 'diff', 'HEAD', '--name-only'], target)
      : [],
    untrackedFiles: present
      ? probe(['git', 'ls-files', '--others', '--exclude-standard'], target)
      : [],
    headMerged: match
      ? run(['git', 'merge-base', '--is-ancestor', match.head, 'origin/main'])
          .ok
      : false,
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

  const problems: string[] = [];
  if (present) {
    const stopped = run(['supabase', 'stop'], target);
    // A worktree without a running stack is the normal case, not a problem.
    if (!stopped.ok && !/no managed stack/i.test(stopped.out + stopped.err))
      console.log(
        `[worktree-clean] warning: supabase stop did not run: ${stopped.err || stopped.out}`,
      );
  }
  // --force: only line-ending noise is left. core.longpaths: node_modules holds
  // paths over 260 characters, which git on Windows cannot delete without it.
  const removed = present
    ? run([
        'git',
        '-c',
        'core.longpaths=true',
        'worktree',
        'remove',
        '--force',
        target,
      ])
    : { ok: true, out: '', err: '' };
  // A failed remove can leave the folder half deleted after git already dropped
  // the registration, so a rerun would no longer find it. The worktree passed
  // every blocker above (clean and merged), so finish deleting the folder here.
  if (!removed.ok && removeDir(target) === null && !existsSync(target))
    removed.ok = true;
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
  // -d also compares against the branch's upstream, which can lag behind a
  // branch that is merged into origin/main. -D runs only after checking the
  // branch itself against origin/main.
  if (match?.branch) {
    const merged = run([
      'git',
      'merge-base',
      '--is-ancestor',
      match.branch,
      'origin/main',
    ]).ok;
    const branch = merged
      ? run(['git', 'branch', '-D', match.branch])
      : { ok: false, out: '', err: 'not merged into origin/main' };
    if (!branch.ok)
      problems.push(`git branch -D ${match.branch}: ${branch.err}`);
  }
  run(['git', 'fetch', '-q', '--prune', 'origin']);
  for (const dir of findStacksForRoot(readStacks(), target)) {
    const problem = removeDir(dir);
    if (problem) problems.push(problem);
  }
  return finish(problems);
}

function finish(problems: string[]) {
  for (const problem of problems)
    console.error(`[worktree-clean] failed: ${problem}`);
  console.log(
    problems.length > 0
      ? '[worktree-clean] finished with problems: see above'
      : '[worktree-clean] done',
  );
  return problems.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  const parsed = parseArgs(Bun.argv.slice(2));
  if (!parsed) {
    console.error(
      'usage: bun run worktree:clean <worktree path or folder name> [--yes] | --orphans [--yes]',
    );
    process.exit(2);
  }
  if (parsed.mode === 'orphans') process.exit(cleanOrphans(parsed.apply));
  process.exit(cleanWorktree(parsed.target, parsed.apply));
}
