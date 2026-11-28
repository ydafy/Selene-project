# Maintenance routine

The weekly and monthly review of the repository's state. An agent collects the data, reports what needs a decision with a recommendation, and the maintainer decides. Each area copies the dependency pattern: data that arrives on its own, a written procedure, and a fixed way to act.

Start a session by telling an agent "Hoy es lunes, hagamos la rutina". The `selene-maintenance-routine` skill (`.agents/skills/selene-maintenance-routine/SKILL.md`) runs this page. Nothing changes the repository, the Supabase project, or GitHub until the maintainer decides, with two exceptions: the agent starts a missing dependency workflow run or reruns a failed report ("A. Dependencies", step 1), and it opens Finding or Idea issues as `AGENTS.md`, "Findings outside the current work", allows.

The dependency routine is a separate session with its own rule. When the maintainer says "la rutina de dependencias", the agent applies the dependency report without asking about each package, and pushes and opens the pull request. The maintainer still decides the merge. The steps are in `docs/dependencies.md`, "Run the dependency routine". Inside this page's routine, systems A to E only report dependencies.

## When to run it

- **Weekly.** Every Monday. The dependency workflows are scheduled for Sunday (`docs/dependencies.md`), so their data is ready by Monday morning. Run systems A to E. `bun run routine:collect` collects their data in about 10 seconds.
- **Monthly.** Once a month, in the first session on or after the 1st (usually the first Monday). Run the weekly routine plus "Monthly checks".

## Run a session

1. Check the tools. Run "Check the tools before you collect" before any other check.
2. Collect. Run `bun run routine:collect` with a timeout of 120 seconds. It only reads, and it prints the data of systems A to E, the open worktrees, the dates, and the topic of the week. Then run the agent steps below that the script does not cover (Sentry, the health advisor, and the questions to the maintainer), and look at the topic of the week ("Pick the topic of the week"). Change nothing.
3. Report. Write the report in the format of "Report format", with the topic's observations in it.
4. Decide. Ask the decisions that are easy to undo together, in questionnaires of up to four questions each. A fifth easy decision goes in a second questionnaire, never into a deferred issue. Ask a decision that is hard to undo on its own: one that costs more than a revert PR to undo, touches security, money, a merge, or a deletion, or affects another active worktree. If a decision in a questionnaire turns out to be hard to undo, take it out and ask it on its own. A question the maintainer leaves unanswered means wait, never act.
5. Record. Each deferred decision becomes a Finding or Idea issue, as `docs/findings.md` describes. A decision about a vulnerability never goes into an issue: it stays in its draft Security Advisory (`docs/findings.md`, "Report a vulnerability"). A decision that changes a procedure on this page changes the page in the same session, on a branch.

## Check the tools before you collect

A check that discovers a missing tool halfway through wastes the data collected before it. `bun run routine:collect` checks its own tools: a section whose command fails prints `Could not check:` with the command and its error, the other sections still run, and the script exits 1. It needs `gh` logged in and the Supabase CLI logged in and linked to the remote project (`supabase db advisors --remote`). Check the MCP servers the agent steps read before you collect:

- The Supabase MCP, for system D (the health advisor and `query_logs`).
- The Sentry MCP, for system D.
- The Stripe MCP, for the monthly checks only.

If the harness defers a server's tools, load them with its tool search first. A server is missing only when its tools still do not appear. Then make one small read-only call to each server that always returns data, such as Sentry `whoami` or Supabase `list_edge_functions`, and keep its result as evidence.

A tool can fail in three ways, and the report names which one:

- **Missing.** Its tools do not appear. Every section that needs it is "Could not check".
- **Error.** The call fails. Every section that needs it is "Could not check", with the error.
- **Empty.** The call works but returns nothing. That call always returns data, so treat it as an error. Later in the session, an empty result is a real result only when this check passed.

Write the result on the "Herramientas" line of the report. Tell the maintainer about a missing tool before you collect, because they may fix it in a minute.

## Check the open worktrees before you act

The maintainer works in several parallel worktrees (`docs/worktrees.md`). Collecting data and deciding are read-only and always safe. Some actions touch resources that every worktree shares, so check the worktrees before you act on a decision.

The "Worktrees" section of `bun run routine:collect` lists every other worktree with its branch, uncommitted files, commits ahead of `origin/main`, and the age of its last commit. It skips the entries under `.git/gentle-ai/candidate-views/<id>`, which the review tool creates. A worktree with uncommitted files, commits ahead of `origin/main`, or a commit in the last 3 days is active. The script lists it under "Active worktrees" with the lockfiles its branch or its working tree changes.

Each worktree has its own folder, branch, `node_modules`, and local Supabase stack. All worktrees share the tools on the machine (Supabase CLI, Docker Desktop, Node, and Bun), the stack data in `~/.supabase/stacks`, and `main`.

While any worktree is active, these actions wait, and the report says why:

- A dependency update, only when an active worktree's "lockfiles changed" is not `none`. If both sides change the lockfile, the merge conflicts. If no active worktree touches them, do the update: each worktree runs `bun install` after it merges `main`.
- A Supabase CLI, Node, or Bun upgrade on the machine. Every worktree switches to the new version at once, and a Supabase CLI major needs `supabase stop` in every worktree first.
- A Docker Desktop update while a local stack runs (`docker ps`). It restarts Docker and stops every local stack.

The maintainer can still decide to do one of them. The report says what it would cost each active worktree.

These actions are safe at any time: GitHub issue changes, read-only reviews, doc changes on their own branch, and deleting orphan stack data (stack data whose worktree folder no longer exists).

## Weekly checks

Each system has three parts:

- **Data.** The section of `bun run routine:collect` that holds its data, or the agent step that collects it. The script prints the dates it used on its `Dates:` line: `since` is 7 days ago, `stale` 60 days ago, `untaken` 14 days ago, and the dependency runs count since the last Sunday.
- **Judge.** What each line means and when it needs a decision. The script computes only what a command can compute. Judging stays with the agent and the maintainer.
- **Look closer.** The commands to run only on an item the data shows.

If a section prints `Could not check:`, that section of the report is "Could not check" with the same command and error. Never collect it by hand instead. A script that fails the same way twice gets a Finding issue (`docs/findings.md`).

### A. Dependencies

The procedure is `docs/dependencies.md`. The action skill is `selene-dependency-review`.

**Data.** The "A. Dependencies" section: one line per dependency workflow and one line for the report issue.

**Judge.**

1. Each workflow line names the newest run since Sunday whose work job (`audit` or `report`) ran, on the scheduled or the manual event. A backup run that found an earlier run skips that job and still ends in `success`, so the script never counts it. A manual run counts too, so a second session the same week does not start the workflows again.
   - `is in_progress` or `is queued` ends in "Wait for it." Wait, then run the script again.
   - `no run since <date> ran the <job> job` ends in "Start it". Start the workflow as `docs/dependencies.md` says (the audit first), and wait for it.
   - A `report` job that ran and did not end in `success` ends in "Rerun the report". Start the report again and wait for it: a failed run leaves last week's report in the issue.
   - An `audit` job that ran and did not succeed is a decision, not a rerun.
2. The report line gives the date of the report and its summary line. A date before this week's Sunday means the report did not update: go back to step 1.

Needs a decision when the audit failed, or the summary counts majors, an Expo SDK upgrade, or a flag in the Runtimes, Supabase CLI, Stripe API version, or GitHub Actions section. Safe updates wait for the monthly checks unless they fix an advisory. For majors and the Expo SDK, run `selene-dependency-review`. If an open issue already decides a major (search the issues for the package name), cite that issue instead of reviewing the major again.

**Look closer.** Read the rows behind a count in the report issue with `gh issue view <number>`.

### B. Security

The procedure is `docs/findings.md`, "Report a vulnerability".

**Data.** The "B. Security" section: the draft Security Advisories, the count of open secret scanning alerts, and the remote security advisor compared with "Accepted findings".

**Judge.**

1. Each draft advisory is an unfixed vulnerability. The script prints only its GHSA ID, severity, and age. Never copy its description into an issue, a commit, or a file.
2. An open secret scanning alert means you rotate the secret first.
3. "Security findings not accepted" lists each finding no entry accepts, with its level. An accepted object no finding reports leaves the list, and an entry whose tracking issue closed needs a new decision ("Accepted findings").

Needs a decision for any draft advisory (which one to fix next), any open alert, any ERROR finding that is not accepted, and each line under the last two lists. Group WARN findings by lint name.

**Look closer.** Read a draft advisory on GitHub only inside the session.

### C. Backlog

The procedure is `docs/findings.md`. `.github/workflows/issue-labels.yml` sets the labels: `priority:critical`, `priority:high`, `priority:medium`, `priority:low`, the eight `area:*` labels, and `finding`, `idea`, and `roadmap`.

**Data.** The "C. Backlog" section: the new issues of the week with their labels, the `Go-live` counts, the critical and high issues, the findings without a priority, the titles that name a type their labels lack, the stale issues, and the PRs open more than 7 days.

**Judge.** Needs a decision for:

- each new issue: is the priority right, is it a duplicate, should it stay open, does it block the launch (`Go-live`);
- a `Go-live` issue with no work started;
- a critical issue with no work started;
- a finding without a priority;
- a title that names a type its labels lack: add the label or fix the title;
- a stale issue: close it, keep it, or change its priority;
- an Idea whose "When to revisit" moment has come;
- a PR open for more than 7 days.

A priority change edits the issue body, not the label (`docs/findings.md`).

**Look closer.** Read an issue with `gh issue view <number>`. List the open `Go-live` issues with `gh issue list --state open --milestone Go-live --json number,title,updatedAt`, and the Ideas with `gh issue list --state open --label idea --limit 200 --json number,title`, then read the "When to revisit" of each one you judge.

### D. App health

This check stays light until go-live. There is no real traffic yet, so it lists what is new instead of comparing with thresholds. The thresholds come with `docs/go-live.md`.

**Data.** The "D. App health" section gives steps 1 and 3. Step 2 and the health advisor are agent steps.

**Judge.**

1. Each failed run on `main` since `since` says whether a later run of the same workflow succeeded.
2. Agent step. Run the Sentry MCP tool `search_issues` with `is:unresolved firstSeen:-7d` in `selene-ze/selene-edge-functions`. For each new issue, read it with `get_sentry_resource`, then read the Supabase logs between its first and last event with the Supabase MCP tool `query_logs` (source `function_logs`, error lines). Search the issues for the error code the logs show: an open Finding may already cover it.
3. "Performance findings not accepted" lists each performance finding no entry accepts. Then, as an agent step, run the Supabase MCP tool `get_advisors` with `type: health`. The health advisor has no accepted list, so judge each of its lints.

Needs a decision for a failure that no later green run of the same workflow explains, a flaky test (it fails, then passes with no change), a new Sentry issue, an ERROR advisor, and each line under the performance lists.

**Look closer.** Read the end of a failed log with `gh run view <id> --log-failed | tail -n 50`.

### E. Workflow

This system reviews how we work: mistakes agents repeat and tooling bugs nobody took. It has the same weight as dependencies. The procedure for agent mistakes is `docs/findings.md`, "Record a repeated agent mistake".

**Data.** The "E. Workflow" section gives steps 1 to 3. Step 4 is an agent step.

**Judge.**

1. "Agent mistakes updated since" lists each `agent-mistake` issue updated this week, with its state and how many comments it got this week. Read each one with `gh issue view <number> --comments`, and classify it by its creation date and its evidence comments (comments that report a new occurrence, not clarifications). An issue created on or after `since` is a first occurrence. An evidence comment dated on or after `since` means the mistake repeated this week, even on an issue opened this week. An issue that only changed labels, or whose evidence comments are older, is not news; step 2 keeps the older repeats. A repeat on an issue with a linked PR means the fix in progress did not prevent it: it needs a decision too.
2. "Open agent mistakes without a linked PR" lists the issues whose guard is still missing, with their comment count. An issue with a comment with new evidence has repeated. Its guard has not landed while no PR links it. Step 1 covers the repeated issues that already have a linked PR. This closes the loop on the guards earlier sessions approved.
3. The two tooling lists hold the tooling findings of the week and the ones nobody took since `untaken` (14 days ago).
4. Agent step. Ask the maintainer: "¿Qué error de un agente corregiste más de una vez esta semana?" No command sees these. For each answer with no `agent-mistake` issue, open one as `docs/findings.md` describes.

For each repeated mistake, propose where its fix goes. Use the order of `docs/findings.md`, step 3: architecture, types, a guard or lint, a behavior test, and a rule in `AGENTS.md` or a skill only last. Propose "no change" when the cost of the mistake is lower than the cost of the fix, and say why. If an existing guard needs many exceptions to stay reliable, propose turning it back into a written rule.

Needs a decision for each repeated mistake without a guard, with the proposed fix, and each tooling finding that nobody took in 14 days.

**Look closer.** Read a finding with `gh issue view <number>`.

## Monthly checks

### F. Agent tools

Run `npx skills check`. It takes about 2 minutes because it fetches every source. Give it a timeout of at least 5 minutes, or run it in the background.

Needs a decision for each skill with an update, grouped by source. The update follows `docs/skills.md`, "Update".

Also check the skills we adapted from pstack, following `docs/skills.md`, "Check adapted skills against pstack". Needs a decision for each upstream change to a path one of them adapts.

Before you update any skill, run `bun run skills:usage`. Reviewing an update reads every updated skill, so a run after it counts that review as use. It reads the Gentle Shell session logs of the last 30 days (`~/.gentle-shell/agent/sessions/` and `~/.gentle-shell/agent/gentle-agents/sessions/`) and counts, per skill, the sessions that read its `.agents/skills/<name>/SKILL.md`. Report the top skills and the list under "Installed with zero reads". If the script prints "No session logs found", the harness keeps no logs: report "Could not check".

Needs a decision for a skill with zero reads in three monthly runs in a row and no upcoming work that needs it. Name the issues or roadmap items you checked for that work. Propose removing the skill. Only the maintainer decides a removal; it follows `docs/skills.md`, "Remove".

### Dependencies by hand

Run the monthly steps of `docs/dependencies.md`, "Follow the cadence": `bun outdated --filter @selene/frontend`, `bun outdated --filter admin-web`, Node and Bun, and Docker Desktop. Report the package updates. The maintainer applies them with the dependency routine (`docs/dependencies.md`, "Run the dependency routine"). The agent cannot see Docker Desktop updates. `docker version --format '{{.Server.Version}}'` shows the local version. Ask the maintainer to look at **Settings** > **Software updates**.

Also compare `supabase --version` with the `version:` of the setup-cli step in `.github/workflows/ci.yml`, run `supabase stack outdated` in the main checkout (an update follows `supabase/AGENTS.md`, "Local stack"), and check whether each `HELD_BACK` blocker in `scripts/ci/dependency-report.ts` is gone.

Read the sandbox webhook endpoints with the Stripe MCP tool `GetWebhookEndpoints` (`livemode: false`). Each `api_version` must equal `STRIPE_API_VERSION` in `supabase/functions/_shared/stripe/api-version.ts`; a mismatch needs a decision.

### Worktrees

A worktree is a cleanup candidate only when `bun run routine:collect` lists it under "Inactive worktrees" ("Check the open worktrees before you act") and its branch is merged: `git merge-base --is-ancestor <branch> origin/main` exits with 0. A merged branch alone is not enough, because a worktree can move on to a new branch. On 2026-11-10, `repo-hygiene` held a merged branch one day and 38 uncommitted files on a new branch the next.

Run these from the main checkout:

1. For each candidate, run `bun run worktree:clean <folder name>`. It prints the plan for that worktree and changes nothing. Without arguments the script prints its usage, not a plan.
2. Run `bun run worktree:clean --orphans`. It lists stack data whose worktree folder no longer exists.
3. If a plan warns about files in `verification-evidence/`, report them. The maintainer decides whether a PR still needs them.

Add `--yes` only with the maintainer's word (`docs/worktrees.md`).

### Manual work that repeats

Ask the maintainer what they did by hand more than once this month. Each answer is a candidate for an automatic report, as the dependency report was. Open an Idea issue for the ones worth automating.

## Pick the topic of the week

Each week the session looks closer at one area, adapted from AWS "The Wheel" (https://aws.amazon.com/blogs/opensource/the-wheel/). The topic is the `area:*` label at index ISO week number modulo 8. `bun run routine:collect` prints it on its `Topic of the week:` line.

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
# Rutina <YYYY-MM-DD>, semana ISO <NN>

**Tema de la semana: <area>**

Herramientas: <OK | <server>: missing, error, or empty>

## Decisiones (<N>)

1. <ID> <item>: <recommendation>, <reason>, <must-have | nice-to-have | overengineering>, <fácil | difícil de deshacer>

## A. Dependencias: <OK | Needs decision | Could not check>

## B. Seguridad: <OK | Needs decision | Could not check>

## C. Backlog: <OK | Needs decision | Could not check>

## D. Salud de la app: <OK | Needs decision | Could not check>

## E. Flujo de trabajo: <OK | Needs decision | Could not check>

## F. Herramientas de agentes (solo mensual): <OK | Needs decision | Could not check>

## Tema de la semana: <area>
```

Follow these rules:

- The report has two levels. The top holds the topic of the week, the tools line, and every decision, one line each. The sections below hold the detail and the evidence.
- The topic of the week keeps its own bold line under the title, every week.
- Each decision has an ID made of its section letter and a number, such as `C2`. The questionnaire and the issues it records use the same ID. The topic's observations use `T`.
- Each decision says whether it is easy or hard to undo, as "Run a session", step 4, defines.
- An OK section is one line.
- Every item cites evidence (command output, an issue number, or a link) and gives a recommendation: do now, wait, or drop. Add its reason and its class: must-have, nice-to-have, or overengineering.
- "Could not check" names the command and the exact blocker, such as a missing MCP server or `gh` not logged in. Never skip a check silently (`AGENTS.md`, "Verifying a change").

## Accepted findings

Without a record, the same known advisor lints come back every week as decisions. An item on one of the two lists below is not a decision. The report counts the listed items in one line: "N accepted findings unchanged". An item that lists its objects becomes a decision again when its count grows or a new object appears under the same lint. An item that accepts every object of its lint (`objects: 'all'`) also accepts a new object. Either kind becomes a decision again when its tracking issue closes.

Add an item only with the maintainer's decision, and write the reason. Remove it when the issue that fixes it merges. Never list a draft Security Advisory in either list: its details stay out of files.

Security findings that show up on the local stack are checked in CI: the `db-test` job runs `bun run db:advisors:check`, which fails on any WARN or ERROR finding missing from `scripts/ci/security-advisor-exceptions.ts`. That file is the list for them, each with its reason; it holds `security_definer_view` on `public.products_public` (decided 2026-11-11, `docs/decision-log.md`). The weekly report counts the entries of both lists as accepted.

`scripts/dev/routine-accepted-findings.ts` is the only list of the items that only the remote project or the performance advisor shows. Each entry names its advisor type and lint, the `cacheKey` of each accepted object (or every object of the lint), the reason, and its tracking issue. `bun run routine:collect` compares `supabase db advisors --remote` with both lists and prints only the findings no entry accepts, the accepted objects no finding reports, and the entries whose tracking issue closed.

## Planned automation

The routine does these by hand today. After it has run for a few weeks, they may move into workflows:

- a Skills section in the weekly dependency report;
- OpenSSF Scorecard (https://scorecard.dev/);
- GitHub Agentic Workflows (https://github.github.com/gh-aw/).

A CI change needs the maintainer's approval (`AGENTS.md`, "Boundaries"). Each one is an Idea issue: #360 (Skills section), #362 (Scorecard), and #363 (Agentic Workflows). The Security Advisor already runs in CI (#361).
