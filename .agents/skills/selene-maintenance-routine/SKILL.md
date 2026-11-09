---
name: selene-maintenance-routine
description: 'Trigger: rutina del lunes, rutina mensual, weekly routine, monthly routine, "Hoy es lunes, hagamos la rutina". Run the checks in docs/maintenance.md and report what needs a decision.'
license: MIT
metadata:
  author: 'school-portal'
  version: '1.0'
---

## Activation Contract

Load when the maintainer asks for the weekly or monthly routine, for example "Hoy es lunes, hagamos la rutina". `docs/maintenance.md` owns the checks, the topic of the week, and the report format. This skill only runs the checks and writes the report.

## Hard Rules

- `AGENTS.md` wins over this skill.
- Change nothing until the maintainer decides: no dependency updates, no issue edits, closes, or label changes, and no branches, commits, or PRs. There are two exceptions:
  - start the dependency workflows when this Monday's run is missing (`docs/dependencies.md`);
  - open Finding or Idea issues, as `AGENTS.md`, "Findings outside the current work", allows.
- Read the remote Supabase project only through the read-only MCP tools that `docs/maintenance.md` names. Never use `execute_sql`.
- Vulnerability details never leave the session.
- Give every long command a timeout. Run `npx skills check` in the background.
- A check that cannot run is "Could not check" with the exact blocker. Never skip it and never fill it from memory.

## Steps

1. Read `docs/maintenance.md` once.
2. Decide from today's date whether the session is weekly or monthly.
3. Run the weekly checks. Run independent checks in parallel. Add the monthly checks when they apply.
4. Pick the topic of the week as the page says.
5. Write the report in the page's format.
6. Walk the decisions with the maintainer, one at a time.
7. Record each decision as the page says.

## Output

The report from `docs/maintenance.md`, "Report format". Then stop and wait for the maintainer.
