---
name: selene-maintenance-routine
description: 'Trigger: rutina del lunes, rutina mensual, weekly routine, monthly routine, "Hoy es lunes, hagamos la rutina", la rutina de dependencias, rutina de dependencias, dependency routine. Run the checks in docs/maintenance.md and report what needs a decision, or apply the dependency report as docs/dependencies.md says.'
license: MIT
metadata:
  author: 'school-portal'
  version: '1.0'
---

## Activation Contract

Load when the maintainer asks for the weekly or monthly routine, for example "Hoy es lunes, hagamos la rutina". `docs/maintenance.md` owns the checks, the topic of the week, and the report format. This skill only runs the checks and writes the report.

## Hard Rules

- `AGENTS.md` wins over this skill.
- Outside the dependency routine (below), change nothing until the maintainer decides: no dependency updates, no issue edits, closes, or label changes, and no branches, commits, or PRs. There are two exceptions:
  - start the dependency workflows when this week's Sunday run is missing (`docs/dependencies.md`);
  - open Finding or Idea issues, as `AGENTS.md`, "Findings outside the current work", allows.
- Read the remote Supabase project only through the read-only MCP tools that `docs/maintenance.md` names. Never use `execute_sql`.
- Vulnerability details never leave the session.
- Give every long command a timeout. Run `npx skills check` in the background.
- A check that cannot run is "Could not check" with the exact blocker. Never skip it and never fill it from memory.

## Steps

1. Read `docs/maintenance.md` once.
2. Decide from today's date whether the session is weekly or monthly.
3. Check the tools as the page's "Check the tools before you collect" says. Load deferred MCP tools with the harness's tool search before you call a server missing. Tell the maintainer about a missing tool before you collect.
4. Run the weekly checks A to E. Run independent checks in parallel. Add the monthly checks when they apply.
5. Pick the topic of the week as the page says.
6. Write the report in the page's format: decisions first, detail below.
7. Ask the decisions as the page's "Run a session", step 4, says: the ones easy to undo together in questionnaires of up to four questions, the ones hard to undo on their own.
8. Record each decision as the page says.

## Dependency routine

When the maintainer says "la rutina de dependencias", "rutina de dependencias", or "dependency routine", follow `docs/dependencies.md`, "Run the dependency routine". That section owns the steps. In this routine you apply the report without asking about each package, then push and open the pull request. The maintainer decides the merge.

## Output

The report from `docs/maintenance.md`, "Report format". Then stop and wait for the maintainer. The dependency routine ends with the pull request instead.
