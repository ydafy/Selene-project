# Worktrees: start and clean up

Features are developed in parallel worktrees under `C:/dev/School-portal-worktrees/`. This page says what a worktree leaves behind and how to remove it when the work is done.

## What a new worktree gets

The Git hooks set up a worktree on their own:

- `post-checkout` copies the gitignored env files from the main checkout (`scripts/dev/worktree-env.ts`) when `git worktree add` creates it.
- `post-checkout`, `post-merge`, `post-commit`, and `post-rewrite` keep the local CodeGraph index current (`scripts/dev/codegraph-refresh.sh`): the first one builds `.codegraph/` in the background, and the next ones sync only the changed files. The native Gentle `codegraph` tool has no file watcher, so this is what keeps its results current. It does nothing when `codegraph` is not installed. Uncommitted edits reach the index at the next commit or checkout; run `codegraph sync` to catch them up earlier.

## What a worktree leaves behind

| Item                                                                                                              | Where                                          | Removed by deleting the folder?                                   |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Worktree folder (`node_modules`, `.env` copies, `.local/`, `.codegraph/`, `bruno/.env`, `verification-evidence/`) | `C:/dev/School-portal-worktrees/<name>`        | Yes                                                               |
| Worktree registration                                                                                             | `.git/worktrees/<name>` in the main checkout   | No: needs `git worktree prune`                                    |
| Local branch                                                                                                      | main checkout                                  | No                                                                |
| Remote branch                                                                                                     | GitHub                                         | Yes, on merge: the repository deletes head branches automatically |
| Local Supabase stack (stack mode creates one per worktree and branch)                                             | `~/.supabase/stacks/<hash>`, Docker containers | No                                                                |

Stack mode keeps one stack per worktree and branch, so a worktree that stays alive also keeps the stacks of every branch it had before. `bun run worktree:clean --stale-stacks` removes those ([below](#stacks-of-old-branches)).

## Clean up a finished worktree

From the main checkout (`C:/dev/School-portal`), never from inside the worktree:

```bash
bun run worktree:clean <folder name or path>        # prints the plan, changes nothing
bun run worktree:clean <folder name or path> --yes  # runs it
```

In order, it stops the worktree's Supabase stack, stops its CodeGraph daemon, removes the worktree, prunes the registration, deletes the local branch with `git branch -D` after checking that the branch is merged into `origin/main` (`-d` would also compare it against its upstream, which can lag behind), prunes remote-tracking branches, and deletes the stack data folders whose `state.json` names the worktree.

It refuses, and changes nothing, when:

- the worktree has uncommitted changes or untracked files (line-ending-only differences do not count);
- its `HEAD` is not in `origin/main`: an unmerged branch, or commits on a detached `HEAD`;
- git cannot read the worktree's status (it never assumes a worktree is clean);
- the target is the main checkout or the worktree the command runs in;
- the path is not a worktree of this repository;
- the arguments mix a worktree with `--orphans` or `--stale-stacks`, or include an unknown flag.

The CodeGraph daemon (its lock file `daemon.pid` lives in `.codegraph/`) is stopped because it outlives the terminal and the agent session that started it: on Windows it keeps the index database in `.codegraph/` open for up to five minutes after its last client leaves, which is why a removal used to work only after waiting or restarting the machine. The command stops it only after the daemon answers on its socket with the pid in the lock file, so a stale lock file never kills an unrelated process that reused the pid.

Git removes the worktree with `core.longpaths` on, because `node_modules` holds paths longer than 260 characters. Deleting `node_modules` prints nothing for a few minutes on Windows, so the command announces it first: do not interrupt it (an interrupted run leaves a half-deleted folder that the same command finishes on a rerun). If `git worktree remove` still fails, the command deletes the folder itself (the worktree already passed every check above). If Windows keeps the folder locked (an open terminal, editor, agent session or Docker Desktop), the command stops: close what holds it and run the same command again.

Git drops the registration even when it cannot delete the folder, so before this fix a rerun answered `is not a worktree of this repository`. Now a rerun recognizes the leftover: a folder whose `.git` file points to a missing `.git/worktrees/<name>` of this repository. Its plan warns that git can no longer check the folder for uncommitted work, then it stops the CodeGraph daemon, deletes the folder, prunes, and deletes the stack data that names the folder. It keeps the data of a stack whose containers still run (or when Docker cannot answer), because `supabase stop` cannot run without the worktree, and names the `supabase stack destroy` command to run. A folder whose `.git` file points anywhere else, or one that contains the main checkout or a registered worktree, is still refused. If a later step fails (deleting the branch or a stack folder), the command names it, ends with `finished with problems` and exits with code 1. A `supabase stop` that could not run is reported as a warning: a worktree without a running stack is the normal case.

## Stack data of worktrees already deleted

```bash
bun run worktree:clean --orphans        # lists stack data whose worktree folder no longer exists
bun run worktree:clean --orphans --yes  # deletes it
```

It only considers stack data of this repository: projects whose root is the main checkout or a folder under `<main checkout>-worktrees` (for example `C:/dev/School-portal-worktrees`). Stack data of other projects on the same machine is never listed, even when their folder is gone.

## Stacks of old branches

```bash
bun run worktree:clean --stale-stacks        # lists every stack of this repository and whether it is stale
bun run worktree:clean --stale-stacks --yes  # destroys the stale ones
```

Run it from the main checkout. It reads `supabase stack list` and treats a stack as stale only when all of these hold:

- its project root is the main checkout or a folder under `<main checkout>-worktrees`;
- it is not the stack of the branch a worktree (or the main checkout) has checked out now;
- its branch no longer exists locally, or is merged into `origin/main`;
- it is not running (the CLI reports its owner as `reachable`): stop it first.

It keeps stacks without a recorded branch and prints the reason for every stack it keeps. With `--yes` it runs `supabase stack destroy --stack-id <id> --yes` for each stale stack. Stacks written by an older CLI that `supabase stack list` cannot decode get their own section: their branch comes from `state.json`, the same rules apply, a stack with running Docker containers is kept, and a stale one is deleted as a folder, because the CLI cannot read it. A stack that fails to go is named, and the command exits with code 1.

## Is any context lost?

No. The history of a feature lives in its merged PR, its commits, its `odd/tasks/<feature>.md` document, its GitHub issues and Engram. The folder, the local branch and the stack data are working copies: the branch is in `main`, and the stack data is local test data that `supabase db reset` rebuilds. The one exception is `verification-evidence/` (gitignored): the plan warns when it has files, so copy it first if a PR or audit needs it.

Do not clean a worktree while its PR is open, its branch is unmerged, or you plan to resume it soon (a new stack takes a while on the first `supabase start`).
