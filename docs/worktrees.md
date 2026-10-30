# Worktrees: start and clean up

Features are developed in parallel worktrees under `C:/dev/School-portal-worktrees/`. This page says what a worktree leaves behind and how to remove it when the work is done.

## What a worktree leaves behind

| Item                                                                                               | Where                                          | Removed by deleting the folder?                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Worktree folder (`node_modules`, `.env` copies, `.local/`, `bruno/.env`, `verification-evidence/`) | `C:/dev/School-portal-worktrees/<name>`        | Yes                                                               |
| Worktree registration                                                                              | `.git/worktrees/<name>` in the main checkout   | No: needs `git worktree prune`                                    |
| Local branch                                                                                       | main checkout                                  | No                                                                |
| Remote branch                                                                                      | GitHub                                         | Yes, on merge: the repository deletes head branches automatically |
| Local Supabase stack (stack mode creates one per worktree and branch)                              | `~/.supabase/stacks/<hash>`, Docker containers | No                                                                |

## Clean up a finished worktree

From the main checkout (`C:/dev/School-portal`), never from inside the worktree:

```bash
bun run worktree:clean <folder name or path>        # prints the plan, changes nothing
bun run worktree:clean <folder name or path> --yes  # runs it
```

In order, it stops the worktree's Supabase stack, removes the worktree, prunes the registration, deletes the local branch with `git branch -d`, prunes remote-tracking branches, and deletes the stack data folders whose `state.json` names the worktree.

It refuses, and changes nothing, when:

- the worktree has uncommitted changes or untracked files (line-ending-only differences do not count);
- its branch is not merged into `origin/main`;
- the target is the main checkout or the worktree the command runs in;
- the path is not a worktree of this repository.

If Windows keeps the folder locked (an open terminal, editor or Docker Desktop), the command stops after the failed remove. Close what holds it, delete the folder by hand, and run the command again: it then finishes the remaining steps.

## Stack data of worktrees already deleted

```bash
bun run worktree:clean --orphans        # lists stack data whose worktree folder no longer exists
bun run worktree:clean --orphans --yes  # deletes it
```

## Is any context lost?

No. The history of a feature lives in its merged PR, its commits, its `odd/tasks/<feature>.md` document, its GitHub issues and Engram. The folder, the local branch and the stack data are working copies: the branch is in `main`, and the stack data is local test data that `supabase db reset` rebuilds. The one exception is `verification-evidence/` (gitignored): the plan warns when it has files, so copy it first if a PR or audit needs it.

Do not clean a worktree while its PR is open, its branch is unmerged, or you plan to resume it soon (a new stack takes a while on the first `supabase start`).
