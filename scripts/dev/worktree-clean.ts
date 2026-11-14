// Removes a finished worktree and everything it left behind: its local Supabase
// stack (stopped, then its data folder under ~/.supabase/stacks), the worktree
// folder and registration, and its merged local branch. Run it from the main
// checkout. Without --yes it only prints the plan.
//
//   bun run worktree:clean <worktree path or folder name>          plan only
//   bun run worktree:clean <worktree path or folder name> --yes    do it
//   bun run worktree:clean --orphans [--yes]   stack data of deleted worktrees
//   bun run worktree:clean --stale-stacks [--yes]   stacks of old branches
//
// It refuses uncommitted or untracked work, an unmerged branch, the main
// checkout, and the worktree it runs in. Stack data is only deleted when its
// state.json names the worktree, so nothing unidentified is ever removed.
// It stops the worktree's CodeGraph daemon first: the daemon outlives the
// terminal that started it and keeps files of the folder open on Windows.
// A folder that git dropped halfway through a removal is finished on a rerun.
import { connect } from 'node:net';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, posix, resolve } from 'node:path';

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
  /** The target folder belongs to a worktree whose registration git already dropped. */
  leftover?: boolean;
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

/** A stack as `supabase stack list --output-format json` reports it. */
export interface ListedStack {
  id: string;
  projectRoot: string;
  branch: string | null;
  running: boolean;
}

export type BranchState = 'missing' | 'merged' | 'unmerged';

export interface StaleInput {
  mainRoot: string;
  worktrees: Worktree[];
  stacks: ListedStack[];
  /** Stacks on disk that the CLI could not decode, identified by state.json */
  undecodable: ListedStack[];
  branchState: (branch: string) => BranchState;
}

export interface StackDecision {
  stack: ListedStack;
  reason: string;
}

export interface StalePlan {
  stale: StackDecision[];
  kept: StackDecision[];
  undecodableStale: StackDecision[];
  undecodableKept: StackDecision[];
}

export function parseStackList(json: string): ListedStack[] | null {
  try {
    const stacks = JSON.parse(json)?.stacks;
    if (!Array.isArray(stacks)) return null;
    return stacks.map((stack) => ({
      id: String(stack.id),
      projectRoot: String(stack.project_root),
      branch:
        typeof stack.branch_context === 'string'
          ? stack.branch_context.replace(/^refs\/heads\//, '')
          : null,
      // "reachable": the CLI reached the process that owns the running stack
      running: stack.owner === 'reachable',
    }));
  } catch {
    return null;
  }
}

/**
 * A stack is stale when it belongs to this repository, is not the stack of a
 * worktree's checked-out branch, its branch is deleted or merged into
 * origin/main, and it is not running.
 */
export function planStaleStacks(input: StaleInput): StalePlan {
  const scopes = orphanScopes(input.mainRoot);
  const decide = (stack: ListedStack) => {
    const current = input.worktrees.find(
      (wt) =>
        wt.branch !== null &&
        wt.branch === stack.branch &&
        samePath(wt.path, stack.projectRoot),
    );
    if (current)
      return { stale: false, reason: `current branch of ${current.path}` };
    if (stack.branch === null)
      return { stale: false, reason: 'no branch recorded' };
    const state = input.branchState(stack.branch);
    if (state === 'unmerged')
      return { stale: false, reason: `unmerged branch ${stack.branch}` };
    if (stack.running)
      return { stale: false, reason: 'running: stop it first' };
    return {
      stale: true,
      reason:
        state === 'missing' ? 'branch deleted' : 'merged into origin/main',
    };
  };
  const split = (stacks: ListedStack[]) => {
    const stale: StackDecision[] = [];
    const kept: StackDecision[] = [];
    for (const stack of stacks) {
      if (!scopes.some((scope) => isInside(stack.projectRoot, scope))) continue;
      const { stale: isStale, reason } = decide(stack);
      (isStale ? stale : kept).push({ stack, reason });
    }
    return { stale, kept };
  };
  const readable = split(input.stacks);
  const old = split(input.undecodable);
  return {
    stale: readable.stale,
    kept: readable.kept,
    undecodableStale: old.stale,
    undecodableKept: old.kept,
  };
}

export function parseArgs(args: string[]) {
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));
  const [target, ...extra] = args.filter((arg) => !arg.startsWith('--'));
  const apply = flags.delete('--yes');
  const orphans = flags.delete('--orphans');
  const staleStacks = flags.delete('--stale-stacks');
  const modes = [Boolean(target), orphans, staleStacks].filter(Boolean);
  if (flags.size > 0 || extra.length > 0 || modes.length !== 1) return null;
  if (orphans) return { mode: 'orphans' as const, apply };
  if (staleStacks) return { mode: 'stale-stacks' as const, apply };
  return { mode: 'worktree' as const, target, apply };
}

/**
 * The registration folder a worktree's `.git` file points to, when it lies in
 * this repository's `.git/worktrees`; null for any other `.git` file.
 */
export function leftoverAdminDir(gitFile: string, gitCommonDir: string) {
  const raw = /^gitdir:\s*(.+?)\s*$/m.exec(gitFile)?.[1];
  if (!raw) return null;
  // Resolve `..` so a gitdir cannot climb out of .git/worktrees.
  const gitdir = posix.normalize(raw.replace(/\\/g, '/'));
  // git keeps each registration exactly one level below .git/worktrees.
  const worktrees = `${gitCommonDir.replace(/\\/g, '/')}/worktrees`;
  return samePath(posix.dirname(gitdir), worktrees) ? gitdir : null;
}

/** The pid and socket of `.codegraph/daemon.pid`, or null when unreadable. */
export function parseDaemonLock(text: string) {
  try {
    const lock = JSON.parse(text);
    if (!Number.isInteger(lock?.pid) || typeof lock?.socketPath !== 'string')
      return null;
    return { pid: lock.pid as number, socketPath: lock.socketPath as string };
  } catch {
    return null;
  }
}

/**
 * A CodeGraph daemon greets every connection with one JSON line naming its pid.
 * Only that answer proves the lock's pid is still the daemon and not a process
 * that reused the pid after a crash.
 */
export function isCodegraphHello(line: string, pid: number) {
  try {
    const hello = JSON.parse(line);
    return typeof hello?.codegraph === 'string' && hello.pid === pid;
  } catch {
    return false;
  }
}

const DAEMON_STEP = 'stop the CodeGraph daemon of the worktree, if one runs';

const evidenceWarnings = (files: number) =>
  files > 0
    ? [
        `verification-evidence/ holds ${files} files and is deleted with the folder: copy it first if a PR needs it`,
      ]
    : [];

const RUNS_INSIDE =
  'this command runs inside the target worktree: run it from the main checkout';

function planLeftover(input: CleanInput): CleanPlan {
  if (isInside(input.currentRoot, input.target))
    return { blockers: [RUNS_INSIDE], warnings: [], steps: [] };
  // Every registered worktree, the main checkout included, stays untouched.
  const contained = input.worktrees
    .filter((wt) => isInside(wt.path, input.target))
    .map((wt) => `${input.target} contains the worktree ${wt.path}`);
  if (contained.length > 0)
    return { blockers: contained, warnings: [], steps: [] };
  return {
    blockers: [],
    warnings: [
      `${input.target} is left over from a removal that stopped halfway: git already dropped its registration, so it can no longer check the folder for uncommitted work`,
      ...evidenceWarnings(input.evidenceFiles),
    ],
    steps: [
      DAEMON_STEP,
      `delete the leftover folder ${input.target}`,
      'git worktree prune',
      'git fetch --prune origin',
      ...input.stackDirs.map((dir) => `delete Supabase stack data ${dir}`),
    ],
  };
}

export function planWorktreeClean(input: CleanInput): CleanPlan {
  const worktree = input.worktrees.find((entry) =>
    samePath(entry.path, input.target),
  );
  if (!worktree && input.leftover) return planLeftover(input);
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
  if (samePath(input.currentRoot, input.target)) blockers.push(RUNS_INSIDE);

  const warnings = evidenceWarnings(input.evidenceFiles);

  const steps = [
    'supabase stop (inside the worktree)',
    DAEMON_STEP,
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

const git = (...args: string[]) => run(['git', ...args]).ok;

function cleanStaleStacks(apply: boolean) {
  const worktrees = parseWorktrees(
    run(['git', 'worktree', 'list', '--porcelain']).out,
  );
  if (!worktrees[0]) {
    console.error('[worktree-clean] run it inside this repository');
    return 1;
  }
  run(['git', 'fetch', '-q', 'origin']);
  // json: the default text table is only replaced by JSON for AI agents
  const listed = run(['supabase', 'stack', 'list', '--output-format', 'json']);
  const stacks = listed.ok ? parseStackList(listed.out) : null;
  if (!stacks) {
    console.error(
      `[worktree-clean] supabase stack list failed: ${listed.err || listed.out}`,
    );
    return 1;
  }
  const known = new Set(stacks.map((stack) => stack.id));
  const undecodable = readStacks()
    .filter(({ dir }) => !known.has(basename(dir)))
    .map(({ dir, identity }) => {
      const id = basename(dir);
      const filter = `label=com.supabase.stack=${id}`;
      const containers = run(['docker', 'ps', '-q', '--filter', filter]);
      // When Docker cannot answer, assume the stack is running and keep it.
      return {
        id,
        ...identity,
        running: !containers.ok || containers.out !== '',
      };
    });
  const plan = planStaleStacks({
    mainRoot: worktrees[0].path,
    worktrees,
    stacks,
    undecodable,
    branchState: (branch) => {
      const ref = `refs/heads/${branch}`;
      if (!git('rev-parse', '--verify', '--quiet', ref)) return 'missing';
      return git('merge-base', '--is-ancestor', ref, 'origin/main')
        ? 'merged'
        : 'unmerged';
    },
  });

  const show = (label: string, { stack, reason }: StackDecision) =>
    console.log(
      `[worktree-clean] ${label} ${stack.id} ${stack.branch ?? '(no branch)'} (${stack.projectRoot}): ${reason}`,
    );
  for (const decision of plan.kept) show('keep', decision);
  for (const decision of plan.stale) show('stale', decision);
  if (plan.undecodableKept.length + plan.undecodableStale.length > 0) {
    console.log(
      '[worktree-clean] stacks the Supabase CLI cannot decode (written by an older CLI); stale ones are deleted as folders:',
    );
    for (const decision of plan.undecodableKept) show('keep', decision);
    for (const decision of plan.undecodableStale) show('stale', decision);
  }
  const count = plan.stale.length + plan.undecodableStale.length;
  if (count === 0) {
    console.log('[worktree-clean] no stale Supabase stacks');
    return 0;
  }
  if (!apply) {
    console.log(
      `[worktree-clean] plan only: add --yes to destroy ${count} stale stacks`,
    );
    return 0;
  }

  const problems: string[] = [];
  for (const { stack } of plan.stale) {
    const destroy = ['stack', 'destroy', '--stack-id', stack.id, '--yes'];
    const destroyed = run(['supabase', ...destroy]);
    if (!destroyed.ok)
      problems.push(
        `supabase stack destroy --stack-id ${stack.id}: ${destroyed.err || destroyed.out}`,
      );
  }
  for (const { stack } of plan.undecodableStale) {
    const problem = removeDir(join(STACKS_DIR, stack.id));
    if (problem) problems.push(problem);
  }
  return finish(problems);
}

/** The first line a socket sends, or null when nothing answers in time. */
function firstLine(socketPath: string, timeoutMs: number) {
  return new Promise<string | null>((resolve) => {
    let buffer = '';
    const socket = connect(socketPath);
    const done = (line: string | null) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(line);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const end = buffer.indexOf('\n');
      if (end >= 0) done(buffer.slice(0, end));
    });
    socket.on('error', () => done(null));
  });
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Stops the CodeGraph daemon that `.codegraph/daemon.pid` names, after the
 * daemon itself confirms its pid. Returns a problem to report, or null.
 */
async function stopCodegraphDaemon(dir: string): Promise<string | null> {
  const lockFile = join(dir, '.codegraph', 'daemon.pid');
  if (!existsSync(lockFile)) return null;
  const lock = parseDaemonLock(readFileSync(lockFile, 'utf8'));
  if (!lock) return null;
  const hello = await firstLine(lock.socketPath, 2_000);
  // No answer: the daemon already exited and left a stale lock file.
  if (hello === null || !isCodegraphHello(hello, lock.pid)) return null;
  try {
    process.kill(lock.pid);
  } catch (error) {
    return `could not stop CodeGraph daemon ${lock.pid}: ${String(error)}`;
  }
  for (let waited = 0; waited < 10_000; waited += 200) {
    if (!isAlive(lock.pid)) return null;
    await Bun.sleep(200);
  }
  return `CodeGraph daemon ${lock.pid} did not exit`;
}

const LOCKED_HINT =
  '[worktree-clean] close terminals, editors and agent sessions in that folder (or restart Docker Desktop), then run this command again: it finishes the removal';

/** The worktree folder a name or path means, for a folder git no longer lists. */
const unregisteredPath = (arg: string, mainRoot: string) =>
  // resolve: the containment checks compare absolute paths, and rmSync on
  // Windows rejects a path that starts with `..`.
  /[\\/]/.test(arg) ? resolve(arg) : join(`${mainRoot}-worktrees`, arg);

function isLeftover(dir: string) {
  const gitFile = join(dir, '.git');
  if (!existsSync(gitFile) || statSync(gitFile).isDirectory()) return false;
  const common = run([
    'git',
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  if (!common.ok) return false;
  const admin = leftoverAdminDir(readFileSync(gitFile, 'utf8'), common.out);
  return admin !== null && !existsSync(admin);
}

async function cleanWorktree(arg: string, apply: boolean) {
  run(['git', 'fetch', '-q', 'origin']);
  const worktrees = parseWorktrees(
    run(['git', 'worktree', 'list', '--porcelain']).out,
  );
  const match = worktrees.find(
    (entry) => samePath(entry.path, arg) || basename(entry.path) === arg,
  );
  const unregistered =
    !match && worktrees[0] ? unregisteredPath(arg, worktrees[0].path) : null;
  const leftover = unregistered !== null && isLeftover(unregistered);
  const target = match?.path ?? (leftover && unregistered ? unregistered : arg);
  const present = Boolean(match) && existsSync(target);

  const plan = planWorktreeClean({
    target,
    leftover,
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
    evidenceFiles:
      present || leftover
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
  if (leftover) return finishLeftover(target);
  if (present) {
    const stopped = run(['supabase', 'stop'], target);
    // A worktree without a running stack is the normal case, not a problem.
    if (!stopped.ok && !/no managed stack/i.test(stopped.out + stopped.err))
      console.log(
        `[worktree-clean] warning: supabase stop did not run: ${stopped.err || stopped.out}`,
      );
    const daemon = await stopCodegraphDaemon(target);
    if (daemon) console.log(`[worktree-clean] warning: ${daemon}`);
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
    console.error(LOCKED_HINT);
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

async function finishLeftover(target: string) {
  const daemon = await stopCodegraphDaemon(target);
  if (daemon) console.log(`[worktree-clean] warning: ${daemon}`);
  const removed = removeDir(target);
  if (removed !== null || existsSync(target)) {
    console.error(
      `[worktree-clean] ${removed ?? `could not delete ${target}`}`,
    );
    console.error(LOCKED_HINT);
    return 1;
  }
  run(['git', 'worktree', 'prune']);
  run(['git', 'fetch', '-q', '--prune', 'origin']);
  const problems: string[] = [];
  for (const dir of findStacksForRoot(readStacks(), target)) {
    // supabase stop cannot run without the worktree: never delete the data of
    // a stack whose containers still run. When Docker cannot answer, keep it.
    const filter = `label=com.supabase.stack=${basename(dir)}`;
    const containers = run(['docker', 'ps', '-q', '--filter', filter]);
    const problem =
      !containers.ok || containers.out !== ''
        ? `${dir} may still have running containers: run supabase stack destroy --stack-id ${basename(dir)} --yes`
        : removeDir(dir);
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
      'usage: bun run worktree:clean <worktree path or folder name> [--yes] | --orphans [--yes] | --stale-stacks [--yes]',
    );
    process.exit(2);
  }
  if (parsed.mode === 'orphans') process.exit(cleanOrphans(parsed.apply));
  if (parsed.mode === 'stale-stacks')
    process.exit(cleanStaleStacks(parsed.apply));
  process.exit(await cleanWorktree(parsed.target, parsed.apply));
}
