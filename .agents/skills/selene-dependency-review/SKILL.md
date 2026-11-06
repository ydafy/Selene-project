---
name: selene-dependency-review
description: 'Trigger: reviewing the weekly dependency report, a major version update, or a new Expo SDK before deciding what to update. Read changelogs, grep our code, check peer ranges, and return a per-package recommendation without changing anything.'
license: MIT
metadata:
  author: 'school-portal'
  version: '1.0'
---

## Activation Contract

Load when the maintainer asks what to do with the majors in the weekly dependency report (issue **Reporte de dependencias**), with one major, or with a new Expo SDK. Read `docs/dependencies.md` once: it owns the semver rules, "When not to update", and the update procedure. This skill only decides what is worth updating and why.

Skip for patch and minor updates (`docs/dependencies.md` covers them) and for the update itself.

## Hard Rules

- `AGENTS.md` wins over this skill.
- Change nothing until the maintainer decides: no `bun add`, `bun update`, `expo install`, edits to any `package.json` or lockfile, branches, commits, or PRs. If you must try a new version, install it in a scratch directory from `mktemp -d`, outside the worktree, and report the directory.
- Never recommend an Expo-pinned package alone. The pin list is `apps/frontend/node_modules/expo/bundledNativeModules.json`. These packages move with the SDK (report section "Expo-pinned packages with a newer major"). Recommend the SDK upgrade instead.
- Respect `HELD_BACK` in `scripts/dependency-report.ts`. A held package is not reviewed again until its blocker changes: check only whether the blocker is gone.
- Cite a source URL for every breaking change you claim. Cite `file:line` for every "affects us: yes". For "no", write the grep that found nothing.
- Write "could not verify" when you could not read the changelog, run the check, or find the code. Never fill the gap with what you remember about the package.

## Steps

1. Get the list. Run `bun scripts/dependency-report.ts` (needs network), or read the issue body with `gh issue view <number> -R ydafy/Selene-project`. The issue can be a week old. Take rows from "Majors available" and the Expo section. Skip "Safe updates" and "Held back on purpose".
2. Classify each row: runtime (shipped in the app or admin bundle), dev tooling (lint, hooks, build), types (`@types/*`), or Expo-pinned.
3. Read the official changelog for the jump from the current version to the latest. Use a migration guide when one exists, else the GitHub releases of every major in between: `gh release view <tag> -R <owner>/<repo>`, the migration guide through `curl https://raw.githubusercontent.com/<owner>/<repo>/main/<path>`, and `curl https://registry.npmjs.org/<name>/<version>` for metadata. A tool dropping a Node.js version counts: compare it with the Node.js version we run (`node -v`, `engines` of the package).
4. Grep the code for each breaking change: imported symbols, renamed options, config files (`eslint.config.js`, `apps/admin-web/eslint.config.js`, `apps/admin-web/vite.config.ts`, `package.json`, `.husky/`). Search `apps/`, `packages/`, `scripts/`, `e2e/`, and `supabase/functions/`.
5. Check peer ranges, per the rule in `docs/dependencies.md`, "When not to update". Read the `peerDependencies` of the new version and of every tool that loads the package (for `eslint`: `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `@typescript-eslint/*`, `eslint-config-prettier`, `eslint-plugin-prettier`). If a tool excludes the new major, the answer is "wait" and the reason names that range.
6. Packages that move together (for example `eslint` in two workspaces and `@eslint/js`) get one table each, with one shared recommendation and one shared "affects us" check.
7. When the evidence is cheap, test instead of guessing. Install the new versions in the scratch directory with a copy of the config and sources. Run the repo's own command (`lint` script of each workspace that uses the package) there and on the current versions, and report both counts. Release notes miss behavior such as ESLint 10 reading the nearest `eslint.config.js` per file.
8. When the Expo section says an SDK upgrade is recommended, add one table for the SDK with the Expo-pinned packages as its rows. Read the SDK release notes, then point to `odd/tasks/expo-sdk-upgrade.md` (procedure) and the vendor skill `expo-upgrade` (mechanics). Do not copy them.

## Output

One table per package, then a short summary. Use these columns exactly.

| Field          | Content                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| from -> to     | Installed version and latest, plus the workspace                                          |
| type           | runtime, dev tooling, types, or Expo-pinned                                               |
| affects us     | yes or no. Evidence: `file:line`, or the grep with no hits. Breaking changes with sources |
| risk           | low, medium, or high, with one sentence                                                   |
| recommendation | update now, wait, or replace, with the reason and the condition that would change it      |

End with the order you suggest (one major per commit, as `docs/dependencies.md` requires) and the checks that apply from `AGENTS.md`, "Verifying a change". Then stop and wait for the maintainer.
