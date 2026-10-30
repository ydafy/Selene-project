# Repository hygiene (phases 1-4)

Clean the repository root, write the conventions, add cheap commit tooling, and make lint and typecheck green and enforced in CI. Worktree `repo-hygiene`, branch `chore/repo-hygiene`.
The frontend move to `src/` and the feature-based layout (phases 5-6) wait until the active worktrees merge; they are out of scope here.

## Specs

- S1. Delete `apps/backend` (dead Express hello world that imports the missing `@school/types`) and `sdd/`. For `openspec/`: "Rescatar lo vivo y borrar el resto" (L4). Move the runbook a test reads to `docs/runbooks/` and the 3 cited specs (`shipments`, `payout-operating-model`, `connect-payout-reconciliation`) to `docs/specs/`, update the test and links, and delete the rest of `openspec/`.
- S2. Fix folder typos (`supabase/queries/addreses`), move `odd/tasks/engram-safe-upgrade.ps1` out of `odd/tasks/`, and prune the stale `shipment-cancellations` worktree.
- S3. `docs/conventions.md` states the rules: folder structure (`shared -> features -> app`, thin routes), one test placement rule (unit tests next to the file they test), file naming (PascalCase for components, camelCase for the rest), no barrel files.
- S4. `apps/frontend/AGENTS.md` exists and the root `AGENTS.md` drops the `apps/backend` and `openspec/, sdd/` rows, names the stack versions, points to `docs/conventions.md`, and groups its boundaries as Always, Ask first, and Never, staying under about 150 lines.
- S5. Pre-commit runs `lint-staged`; the full `bun test` moves to pre-push; a `commit-msg` hook rejects messages that are not Conventional Commits; a PR template carries the verification checklist; `prepare` uses husky v9.
- S6. Lint and typecheck reach zero errors one workspace at a time, and CI enforces each workspace once it is clean. Branch protection on `main` is set by the maintainer in GitHub settings.

## Tasks

- T1 | S1-S2 | inline | commit: d796757 (done)
- T2 | S3-S4 | worker | commit: see L9 (done)
- T3 | S5 | inline | commit: pending
- T4 | S6 | inline, one commit per workspace | commit: pending

## Log

- L1 (user): "master qeuria saber si era posible que analziaralas la estructura de carpetas del repo y mas que anda acomodar todo de manera ms profesional o mas 'clean'/'escalable', primero analiza como esta todo en mi repo dame tu opjinion y dime que me recomeinas hacer dado el proyecto."
- L2 (user): "okey me encanta, porfa da una revisada e invetsiga mas en interenet sobre estructuira de carpetas sober todo con expo/react natvie, y cuales son como las 'best practices' o 'clean parctices' para repos mantenibles y escalables. SObre agents.md, tienes permiso para comentarme cosas, osea que uquitar que agregar que mejorar. [...] Cuando termines me armas como el plan y me dices si abrimos un woktree paarte paara ezto o lo hacemos auqi en la carpeta main."
- L3 (user): "perfecto, me gusta todo el gameplan. confirmo, crea el woktree nuevo y ahi empeiza el plan master." Approves the six-phase plan, the deletion of `apps/backend`, `sdd/`, and `openspec/`, and the configuration changes of phases 3 and 4.
- L4 (user decision): `openspec/` is partly live (a contract test reads `openspec/changes/archive/2026-09-05-standardize-checkout-deterministic-uuids/cutover-runbook.md`; 3 specs are cited as current contracts). Chose "Rescatar lo vivo y borrar el resto (recomendado)".
- L5 (research): sources for S3: Expo blog "How to organize Expo app folder structure for clarity and scalability" (src/app, thin routes, one naming style, colocated tests), bulletproof-react `docs/project-structure.md` (features, one-way imports, no barrels), GitHub blog "How to write a great agents.md" (six areas, three-tier boundaries).
- L6: open issues checked; none covers this work.
- L7 (evidence T1): `odd/tasks/engram-safe-upgrade.ps1` was already gone on `origin/main`. Removing `apps/backend` changed the hoisted root `typescript` from 5.9.3 to 6.0.3 (the version root ESLint resolves), so the root `package.json` pins `typescript` `~5.9.3`; `bun install` then reports no install changes. `deno.lock` drops the `apps/backend` workspace member. `git worktree prune` removed the stale `shipment-cancellations` record. `bun test`: 4212 pass, 0 fail. The audit command from `dependency-audit.yml` reports 1 high, `decode-uri-component@0.2.2` (GHSA-qr28-fpjm-wq7f), already present in `origin/main`'s `bun.lock`, so not caused by this change.
- L8 (baseline for T4): `tsc` errors: `packages/types` 1, `apps/admin-web` 0, `apps/frontend` 17 (all in test files). ESLint: 92 errors (71 `no-explicit-any`, 14 `no-unused-vars`, 7 `no-require-imports`): `apps/frontend` 65, `apps/admin-web` 13, `supabase/functions` 11, `.agents/skills` 3.
- L9 (evidence T2): `docs/conventions.md` (76 lines) and `apps/frontend/AGENTS.md` (24 lines) added. Root `AGENTS.md` 139 to 154 lines: stack versions in the Map intro, frontend guide in "Read first", a conventions row in "Where truth lives", and a `## Boundaries` section (Always, Ask first, Never) built only from rules moved out of "How we work", "Git", "Verifying a change", and the Supabase bullet. The camelCase count is 207 at this commit. `bunx prettier --check` passes.
