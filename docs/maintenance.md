# Maintenance routine

The weekly and monthly review of the repository's state. An agent collects the data, reports what needs a decision with a recommendation, and the maintainer decides. Each area copies the dependency pattern: data that arrives on its own, a written procedure, and a fixed way to act.

Start a session by telling an agent "Hoy es lunes, hagamos la rutina". The `selene-maintenance-routine` skill (`.agents/skills/selene-maintenance-routine/SKILL.md`) runs this page. Nothing changes the repository, the Supabase project, or GitHub until the maintainer decides, with two exceptions: the agent starts a missing dependency workflow run, and it opens Finding or Idea issues as `AGENTS.md`, "Findings outside the current work", allows.

## When to run it

- **Weekly.** Every Monday, after the dependency workflows (08:17 and 08:47 Mexico City time). Run systems A to D. It takes about 45 minutes.
- **Monthly.** Once a month, in the first session on or after the 1st (usually the first Monday). Run the weekly routine plus "Monthly checks".

## Run a session

1. Collect. Run every check below in order, then look at the topic of the week ("Pick the topic of the week"). Change nothing.
2. Report. Write the report in the format of "Report format", with the topic's observations in it.
3. Decide. Walk every decision in the report with the maintainer, one at a time.
4. Record. Each deferred decision becomes a Finding or Idea issue, as `docs/findings.md` describes. A decision about a vulnerability never goes into an issue: it stays in its draft Security Advisory (`docs/findings.md`, "Report a vulnerability"). A decision that changes a procedure on this page changes the page in the same session, on a branch.

## Check the open worktrees before you act

The maintainer works in several parallel worktrees (`docs/worktrees.md`). Collecting data and deciding are read-only and always safe. Some actions touch resources that every worktree shares, so check the worktrees before you act on a decision.

1. Run `git worktree list`. Ignore the entries whose path ends in `.git/gentle-ai/candidate-views/<id>`. The review tool creates them, and they are not the maintainer's work.
2. For each other worktree, collect its branch and these three values:

   ```bash
   git -C <path> status --short | wc -l              # uncommitted files
   git -C <path> rev-list --count origin/main..HEAD  # commits ahead of origin/main
   git -C <path> log -1 --format=%cr                 # age of the last commit
   ```

   A worktree with uncommitted files, commits ahead of `origin/main`, or a commit in the last few days is active.

Each worktree has its own folder, branch, `node_modules`, and local Supabase stack. All worktrees share the tools on the machine (Supabase CLI, Docker Desktop, Node, and Bun), the stack data in `~/.supabase/stacks`, and `main`.

While any worktree is active, these actions wait, and the report says why:

- A dependency update, only when an active branch also changes `bun.lock` or a `package.json`. Check each worktree with `git -C <path> diff --name-only origin/main...HEAD` and `git -C <path> status --short`. If both sides change the lockfile, the merge conflicts. If no active branch touches them, do the update: each worktree runs `bun install` after it merges `main`.
- A Supabase CLI, Node, or Bun upgrade on the machine. Every worktree switches to the new version at once, and a Supabase CLI major needs `supabase stop` in every worktree first.
- A Docker Desktop update while a local stack runs (`docker ps`). It restarts Docker and stops every local stack.

The maintainer can still decide to do one of them. The report says what it would cost each active worktree.

These actions are safe at any time: GitHub issue changes, read-only reviews, doc changes on their own branch, and deleting orphan stack data (stack data whose worktree folder no longer exists).

## Weekly checks

Set two dates first. The commands below read them:

```bash
since=$(date -d '7 days ago' +%F)
stale=$(date -d '60 days ago' +%F)
```

Each system says where its data comes from, which commands to run, and when it needs a decision.

### A. Dependencies

The procedure is `docs/dependencies.md`. The action skill is `selene-dependency-review`.

1. Check that both workflows ran today:

   ```bash
   gh run list --workflow dependency-audit.yml -L 1
   gh run list --workflow dependency-report.yml -L 1
   ```

   If either has no run today, start it as `docs/dependencies.md` says (the audit first), and wait for it.

2. Read the report issue:

   ```bash
   gh issue list --search "Reporte de dependencias in:title" --state open
   gh issue view <number>
   ```

Needs a decision when the audit failed, or the report has rows under "Majors available", an Expo SDK upgrade, or a flag in the Runtimes, Supabase CLI, Stripe API version, or GitHub Actions section. Safe updates wait for the monthly checks unless they fix an advisory. For majors and the Expo SDK, run `selene-dependency-review`. If an open issue already decides a major (search the issues for the package name), cite that issue instead of reviewing the major again.

### B. Security

The procedure is `docs/findings.md`, "Report a vulnerability".

1. List the draft Security Advisories:

   ```bash
   gh api "repos/ydafy/Selene-project/security-advisories?state=draft" --jq '[.[] | {ghsa_id, severity, created_at}]'
   ```

   Each draft is an unfixed vulnerability. Report only its GHSA ID, severity, and age. Never copy its description into an issue, a commit, or a file.

2. Count the open secret scanning alerts:

   ```bash
   gh api "repos/ydafy/Selene-project/secret-scanning/alerts?state=open" --jq length
   ```

   An open alert means you rotate the secret first.

3. Run the Supabase MCP tool `get_advisors` with `type: security` on the remote project. The tool is read-only.

Before you decide on a lint, compare it with "Accepted findings". Needs a decision for any draft advisory (which one to fix next), any open alert, and any ERROR lint that is not an accepted finding. Group WARN lints by lint name.

### C. Backlog

The procedure is `docs/findings.md`. `.github/workflows/issue-labels.yml` sets the labels: `priority:critical`, `priority:high`, `priority:medium`, `priority:low`, the eight `area:*` labels, and `finding`, `idea`, and `roadmap`.

```bash
# New issues of the week
gh issue list --state open --search "created:>=$since" --json number,title,labels
# Open critical and high
gh issue list --state open --label priority:critical
gh issue list --state open --label priority:high
# Findings with no priority label
gh issue list --state open --label finding --limit 200 --json number,title,labels --jq '.[] | select([.labels[].name | startswith("priority:")] | any | not) | {number, title}'
# Stale issues: no update in 60 days
gh issue list --state open --search "updated:<$stale"
# Open PRs
gh pr list --state open --json number,title,createdAt,isDraft
```

Needs a decision for:

- each new issue: is the priority right, is it a duplicate, should it stay open;
- a critical issue with no work started;
- a finding without a priority;
- a stale issue: close it, keep it, or change its priority;
- an Idea whose "When to revisit" moment has come;
- a PR open for more than 7 days.

A priority change edits the issue body, not the label (`docs/findings.md`).

### D. App health

This check stays light until go-live. There is no real traffic yet, so it lists what is new instead of comparing with thresholds. The thresholds come with `docs/go-live.md`.

1. List the failed runs on `main`, then read the end of each failed log:

   ```bash
   gh run list --branch main --status failure --created ">=$since" --json databaseId,workflowName,displayTitle,createdAt
   gh run view <id> --log-failed | tail -n 50
   ```

2. Run the Sentry MCP tool `search_issues` with `is:unresolved firstSeen:-7d` in `selene-ze/selene-edge-functions`. For each new issue, read it with `get_sentry_resource`, then read the Supabase logs between its first and last event with the Supabase MCP tool `query_logs` (source `function_logs`, error lines). Search the issues for the error code the logs show: an open Finding may already cover it.
3. Run the Supabase MCP tool `get_advisors` with `type: performance`, then with `type: health`. Before you decide on a lint, compare it with "Accepted findings".

Needs a decision for a failure that no later green run of the same workflow explains, a flaky test (it fails, then passes with no change), a new Sentry issue, and an ERROR advisor.

## Monthly checks

### E. Agent tools

Run `npx skills check`. It takes about 2 minutes because it fetches every source. Give it a timeout of at least 5 minutes, or run it in the background.

Needs a decision for each skill with an update, grouped by source. The update follows `docs/skills.md`, "Update".

Also check the skills we adapted from pstack, following `docs/skills.md`, "Check adapted skills against pstack". Needs a decision for each upstream change to a path one of them adapts.

Before you update any skill, run `bun run skills:usage`. Reviewing an update reads every updated skill, so a run after it counts that review as use. It reads the Gentle Shell session logs of the last 30 days (`~/.gentle-shell/agent/sessions/` and `~/.gentle-shell/agent/gentle-agents/sessions/`) and counts, per skill, the sessions that read its `.agents/skills/<name>/SKILL.md`. Report the top skills and the list under "Installed with zero reads". If the script prints "No session logs found", the harness keeps no logs: report "Could not check".

Needs a decision for a skill with zero reads in three monthly runs in a row and no upcoming work that needs it. Name the issues or roadmap items you checked for that work. Propose removing the skill. Only the maintainer decides a removal; it follows `docs/skills.md`, "Remove".

### Dependencies by hand

Run the monthly steps of `docs/dependencies.md`, "Follow the cadence": `bun outdated --filter @selene/frontend`, `bun outdated --filter admin-web`, Node and Bun, and Docker Desktop. The agent cannot see Docker Desktop updates. `docker version --format '{{.Server.Version}}'` shows the local version. Ask the maintainer to look at **Settings** > **Software updates**.

Also compare `supabase --version` with the `version:` of the setup-cli step in `.github/workflows/ci.yml`, and check whether each `HELD_BACK` blocker in `scripts/ci/dependency-report.ts` is gone.

### Worktrees

A worktree is a cleanup candidate only when it is not active ("Check the open worktrees before you act"). It has no uncommitted files, no commits ahead of `origin/main`, and no recent work, and its branch is merged: `git merge-base --is-ancestor <branch> origin/main` exits with 0. A merged branch alone is not enough, because a worktree can move on to a new branch. On 2026-11-10, `repo-hygiene` held a merged branch one day and 38 uncommitted files on a new branch the next.

Run these from the main checkout:

1. For each candidate, run `bun run worktree:clean <folder name>`. It prints the plan for that worktree and changes nothing. Without arguments the script prints its usage, not a plan.
2. Run `bun run worktree:clean --orphans`. It lists stack data whose worktree folder no longer exists.
3. If a plan warns about files in `verification-evidence/`, report them. The maintainer decides whether a PR still needs them.

Add `--yes` only with the maintainer's word (`docs/worktrees.md`).

### Manual work that repeats

Ask the maintainer what they did by hand more than once this month. Each answer is a candidate for an automatic report, as the dependency report was. Open an Idea issue for the ones worth automating.

## Pick the topic of the week

Each week the session looks closer at one area, adapted from AWS "The Wheel" (https://aws.amazon.com/blogs/opensource/the-wheel/). The topic is the `area:*` label at index ISO week number modulo 8:

```bash
echo $(( 10#$(date +%V) % 8 ))
```

| Index | Area             |
| ----- | ---------------- |
| 0     | `payments`       |
| 1     | `orders`         |
| 2     | `mobile`         |
| 3     | `admin-web`      |
| 4     | `edge-functions` |
| 5     | `database`       |
| 6     | `tooling`        |
| 7     | `docs`           |

Week 46 of 2026 gives 6, `tooling`. The maintainer can swap the topic.

The look is read-only and takes about 15 minutes:

1. Read the area's open issues: `gh issue list --state open --label area:<name>`.
2. Read the area's guide from the map in `AGENTS.md`, and its part of `docs/go-live.md`.
3. Read the commits of the last 4 weeks that touch the area's folders: `git log --since="4 weeks ago" --oneline -- <folders>`. The whole log is too long to read (about 1,200 commits in the 4 weeks before 2026-11-09).
4. Answer: what is fragile or untested, what is missing before go-live, and what you would do differently today. Is there a better current practice? Cite its source.

Write at most three observations. Classify each one as must-have, nice-to-have, or overengineering for a solo-developer MVP (`AGENTS.md`, "How we work"), and give a recommendation.

## Report format

Write the report in the maintainer's language, with this template:

```markdown
# Rutina <YYYY-MM-DD>, semana ISO <NN>, tema: <area>

<N> decisiones pendientes.

## A. Dependencias: <OK | Needs decision | Could not check>

## B. Seguridad: <OK | Needs decision | Could not check>

## C. Backlog: <OK | Needs decision | Could not check>

## D. Salud de la app: <OK | Needs decision | Could not check>

## E. Herramientas de agentes (solo mensual): <OK | Needs decision | Could not check>

## Tema de la semana: <area>

## Decisiones

1. <item>: <recommendation>, <reason>, <must-have | nice-to-have | overengineering>
```

Follow these rules:

- An OK section is one line.
- Every item cites evidence (command output, an issue number, or a link) and gives a recommendation: do now, wait, or drop. Add its reason and its class: must-have, nice-to-have, or overengineering.
- "Could not check" names the command and the exact blocker, such as a missing MCP server or `gh` not logged in. Never skip a check silently (`AGENTS.md`, "Verifying a change").

## Accepted findings

Without a record, the same known advisor lints come back every week as decisions. An item listed here is not a decision. The report counts the listed items in one line: "N accepted findings unchanged". An item becomes a decision again when its count grows, a new object appears under the same lint, or its tracking issue closes.

Add an item only with the maintainer's decision, and write the reason. Remove it when the issue that fixes it merges. Never list a draft Security Advisory here: its details stay out of files.

The Supabase MCP tool `get_advisors` confirmed these items on 2026-11-09:

| Source      | Lint                                                                                                     | Objects                                                                                                                                                                                                               | Why accepted                                                                                                                                                                                                                  | Tracked by                               |
| ----------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| security    | `security_definer_view` (ERROR)                                                                          | `public.products_public`                                                                                                                                                                                              | Decided 2026-11-11 (`docs/decision-log.md`). The view lists only the columns a buyer needs; `security_invoker` would need a row policy on `products` that shows the hidden columns of public listings to every signed-in user | None. Revisit if the view gains a column |
| security    | `rls_enabled_no_policy` (INFO)                                                                           | 7 domain tables that stay in `public`: `connect_payout_runs`, `connect_payout_run_shipments`, `shipment_cancellation_operations`, `shipment_completion_events`, `push_tokens`, `push_deliveries`, `push_event_policy` | Server-owned records that server code reaches through RPCs and the service role. No client policy is intended (`odd/tasks/internal-schema.md`, S3)                                                                            | None                                     |
| security    | `rls_enabled_no_policy` (INFO)                                                                           | 2 server-only tables still in `public`: `checkout_recovery_shells`, `stripe_fee_reconciliation_jobs`                                                                                                                  | They move to the `internal` schema (`odd/tasks/internal-schema.md`, T6). The other five moved in `supabase/migrations/20261113004344_internal_tables_machinery.sql` and no longer appear                                      | #306                                     |
| security    | `anon_security_definer_function_executable`, `authenticated_security_definer_function_executable` (WARN) | 3 and 14 functions                                                                                                                                                                                                    | The roadmap item sets explicit grants per role and function                                                                                                                                                                   | #305                                     |
| security    | `extension_in_public` (WARN)                                                                             | `pg_net`                                                                                                                                                                                                              | Move it to the `extensions` schema                                                                                                                                                                                            | #312                                     |
| security    | `auth_leaked_password_protection` (WARN)                                                                 | Auth setting                                                                                                                                                                                                          | Needs the Pro plan. A manual Dashboard step before go-live                                                                                                                                                                    | #313                                     |
| performance | `auth_rls_initplan`, `multiple_permissive_policies` (WARN)                                               | 5 and 14 policies                                                                                                                                                                                                     | RLS performance work                                                                                                                                                                                                          | #310                                     |
| performance | `unindexed_foreign_keys`, `unused_index` (INFO)                                                          | 8 foreign keys, 23 indexes                                                                                                                                                                                            | Unused indexes mean nothing on test data. Reviewed after real traffic                                                                                                                                                         | #310                                     |

## Planned automation

The routine does these by hand today. After it has run for a few weeks, they may move into workflows:

- a Skills section in the weekly dependency report;
- `supabase db advisors --type security --fail-on error` in CI;
- OpenSSF Scorecard (https://scorecard.dev/);
- GitHub Agentic Workflows (https://github.github.com/gh-aw/).

A CI change needs the maintainer's approval (`AGENTS.md`, "Boundaries"). Each one is an Idea issue: #360 (Skills section), #361 (Security Advisor in CI), #362 (Scorecard), and #363 (Agentic Workflows).
