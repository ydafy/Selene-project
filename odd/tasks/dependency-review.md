# Dependency review (#126, #107, #106)

Fix the weekly dependency report's Expo classification, add the `selene-dependency-review` skill, and add the `correct` principle to `selene-engineering-principles`. One PR per task, in worktree `repo-hygiene`.
The Expo SDK 58 plan (with #99) is out of scope: another session owns it (L1).

## Specs

- S1 (#126). Expo-pinned native packages never appear under "Safe updates" or "Majors available". The pin list is the installed SDK's `apps/frontend/node_modules/expo/bundledNativeModules.json`, not a name prefix. Issue #126: "These packages should appear in the Expo section (they move with the SDK 58 upgrade), not as majors to update one by one." Affected today: `@react-native-async-storage/async-storage`, `@stripe/stripe-react-native`, `react-native-gesture-handler`, `react-native-get-random-values`, `react-native-webview`, `react-native-worklets`.
- S2 (#126). If the pin list cannot be read, the report says "Could not check" for it and the script exits 1, like any other failed collector; it never presents unclassified app packages as majors to update one by one.
- S3 (#107). A project skill `.agents/skills/selene-dependency-review/` that "tells an agent to run the weekly dependency report (`scripts/dependency-report.ts`), read the official changelog of each major update and of the new Expo SDK, grep the code for the affected APIs, and return one table per package: from -> to, type, whether it affects us (with file evidence), risk, and a recommendation (update now / wait / replace). It changes nothing until the maintainer decides; the update itself then follows `docs/dependencies.md`." Listed as ours in `AGENTS.md` "Skills" and `docs/skills.md`. Proven by running it on the real majors of the current report; the Expo SDK part is validated later by the SDK 58 session (L1).
- S4 (#106, `correct` only). `selene-engineering-principles` gains the practice "turn a mistake agents repeat into enforcement (type, lint rule or test) instead of another prompt rule": order architecture > types > lint > test > docs, applied only after the same mistake happened twice with evidence; a new lint, hook or CI check needs the maintainer's approval (`AGENTS.md`). No rule table in `AGENTS.md`. `benchmark-checklist` and hillclimb stay in #106 for the first performance task.

## Tasks

- T1 | S1-S2 | worker (context backstop) | branch `fix/dependency-report-expo-pins` | commit: this commit (done)
- T2 | S4 | inline | branch `docs/correct-principle` (stacked on T1) | commit: this commit (done)
- T3 | S3 | inline | branch `docs/dependency-review-skill` (after T1 merges) | commit: pending

## Log

- L1 (user): "osi master quiero seguir tu recomendacion con una expecion el 2 lo hare en otro woktree , dime ocupas eso para hacer 3 y 4 ? si no, pues deja nomas 1 3 y 4, y la otra seison se hace cargo del 2, si si lo ocupas me dices y termino la otra seiosn y veulvo aca contigo". Recommendation it refers to: 1 fix #126, 2 SDK 58 plan with #99, 3 #107 distilled from a real analysis, 4 the `correct` section of #106.
- L2 (decision): T3 does not wait for the SDK 58 plan: after T1, the report keeps about nine real non-Expo majors to prove the skill on.
- L3 (evidence T1): the pin list is read from `bundledNativeModules.json` (`parseExpoPins`, collector `expoPins`). Pinned majors move to a new Expo subsection, "Expo-pinned packages with a newer major". A failed pin read exits 1 and withholds unclassified app rows from safe updates and majors. RED: `Export named 'parseExpoPins' not found`. GREEN: `bun test scripts/` 206 pass; eslint and prettier clean. Real run exit 0: 9 majors (was 15), and the six S1 packages are under the new Expo subsection. Also seen, outside this task: 5 new high node-forge advisories (GHSA-5x38-2vff-x55p, GHSA-7wch-p9px-956x, GHSA-8hrf-8g6f-7xwp, GHSA-hqq3-7jhf-c5jx, GHSA-jc66-7q78-782g), fixed in node-forge 1.4.2, which fits `@expo/cli`'s `^1.3.3`.
- L4 (incident): the T1 worker left the worktree on a detached `origin/main`, so `a5ab1a65` was committed off-branch. Recovered with fast-forward merges; no history rewritten.
- L5 (evidence T2): `references/principles.md` §10 "Encode repeated mistakes in structure"; `SKILL.md` trigger, activation line, a Decision Gates row, and "ten adapted principles". `benchmark-checklist` and hillclimb stay in #106. Prettier clean.
