# Decision Log

## 2025-10-18: Development Environment Setup

**Decision:** The project MUST reside outside of any cloud-synced folders (OneDrive, Dropbox, etc.).

**Context:** After extensive debugging of Metro errors (`Failed to get SHA-1`), it was determined that the root cause was interference between OneDrive's file sync system and the Metro watcher.

**Consequence:** Moving the project to a simple path like `C:\dev\` resolved all Metro resolution issues. This is a non-negotiable rule for developing this project on Windows.

## 2025-10-18: Installing Expo Dependencies in a Monorepo

**Decision:** All `expo install` (or `bun expo install`) commands MUST be executed from within the application's workspace directory (e.g., `apps/frontend`), not from the Monorepo root.

**Context:** It was observed that when executing `bun expo install <package>` from the root, the package was incorrectly added to the root `package.json` instead of the frontend workspace's `package.json`. This caused native autolinking failures during the EAS prebuild, resulting in "Cannot find native module" errors.

**Consequence:** The standard workflow for adding an Expo dependency to the frontend will be:

1. `cd apps/frontend`
2. `bun expo install <package-name>`

## 2025-11-09: Workspace Dependency Location

**Decision:** Shared and frontend dependencies (`zustand`, `react-query`, etc.) will remain in the `package.json` file in the monorepo root.

**Context:** While the ideal practice is to isolate dependencies by workspace, the current configuration is stable after a complex initial setup. To prioritize the stability of the development environment, it was decided not to move these dependencies at this time.

**Consequence:** This simplifies version management for now. This decision will be reviewed in the future if a new workspace (e.g., a web app) that does not share these dependencies is added.

## 2026-01-27: Instability with Bun, Expo, and EAS in a Monorepo

**Context** A monorepo with Bun as the package manager, Expo for the frontend, and EAS Build for Android.

The project was working correctly with:

- Node.js `22.13.1`
- Bun `1.3.11`
- Expo SDK `~54.0.13`

---

**Problem**

Unexpectedly:

- `bun run frontend` stopped working.

- `bun install` failed due to a `postinstall` error from **Supabase**.

- Expo did not detect the SDK version (`expo` apparently was not installed).

- EAS Build failed with:

bun install --frozen-lockfile exited with code 127

bunx: command not found

- Bun automatically updated to a different version, causing discrepancies between the local and CI versions.

---

**Causes**

- Version misalignment (local Bun ≠ Bun in EAS).

- Bun blocking `postinstall` scripts (Supabase).

- `prepare` script running `bunx husky` in CI.

- Different behavior between local environment and EAS.

--
**Decisions**

- Fix versions:
- Node `22.13.1`
- Bun `1.3.11`
- Keep Bun as package manager (do not migrate to npm/yarn).

- Avoid running Husky in CI.

- Align local environment with `apps/frontend/eas.json`.

--
**Result**

- `bun install` is stable again.

- `bun run frontend` works correctly.

- EAS Build no longer fails during the dependency phase.

- Local environment and CI are now synchronized.

## 2026-02-19: Nuclear Cleanup Strategy in Monorepo (Expo + Bun)

**Problem**

Intermittent errors in the project: - Cannot find module - Expo SDK not detected - App opens and closes on its own - Expo doctor reports duplicate native libraries - Metro launches but the app crashes - Duplicates within .bun files

**Context**

The combined use of: - Expo - Bun - Monorepo with workspaces - EAS Build

Can generate multiple internal instances of native modules.

Expo does NOT allow duplicates in native modules.

---

**Decision**

When structural errors or native duplicates exist or any type of **node modules errors**, apply Nuclear Cleanup.

---

**Nuclear Cleanup Procedure**

**Decaprited**

It was shown that using only `bun npm cache clean` and `bun pm cache rm` solves the entire problem. This section is not deleted because it may be useful if, for some reason, the cleaning with `bun` is not sufficient.

    From the monorepo root:

        rm -rf node_modules
        rm -rf bun.lock
        rm -rf apps/frontend/node_modules
        rm -rf apps/frontend/bun.lock
        rm -rf apps/frontend/.expo
        rm -rf apps/frontend/.expo-shared
        rm -rf apps/admin-web/node_modules
        rm -rf packages/types/node_modules
        rm -rf apps/backend/node_modules

        bun pm cache clean
        bun pm cache rm

        bun install.

**New way**

        bun pm cache clean
        bun pm cache rm

Only right this comands in the main root of the project and start de server whit 'bun run frontend --clear'

Validate status:

    cd apps/frontend

    bunx expo config --json

    bunx expo-doctor

    If it returns JSON + expo doctor without complaints = Healthy project.

    If the bunx expo config --json keep failing, do the Nuclear Cleanup Procedure, then restart the pc and then bun install. Some times the pc keeps cache files even if the Nuclear Cleanup has been done.

---

**Golden Rule**

Always install Expo dependencies from:

cd apps/frontend

bun expo install <package>

Avoid running the manual `bun install` command unnecessarily afterward in 'main'.

---

**Results**

Nuclear Cleanup has consistently resolved: - Version conflicts - Native duplicates - EAS failures - Undetected SDK - Unexpected app crashes

It is established as the standard procedure for structural inconsistencies.

## 2026-05-28: Admin-web User Lists Stay as Cards

**Decision:** The five card lists in `apps/admin-web/src/features/users/components/` (`UserReviewsList`, `UserReportsList`, `UserDisputesList`, `UserAddressesList`, `UserAdminHistory`) stay as cards and do not move to `DataTable<TData>`.

**Context:** The admin-web type-safety and TanStack Table migration (phase 2, PH2-REQ-015) asked which lists should become tables. These lists are not tabular data: reviews have an avatar, a star rating, and a comment block; reports are a feed with quoted reasons; disputes show per-user win or loss badges and role badges; addresses are multi-line documents with a default badge; the admin history holds two streams (audit log and notes) with different shapes. Table cells would flatten all of that. The migration still replaced their `any` types with typed interfaces or `Tables<...>` aliases.

**Consequence:** Move a list to `DataTable` on its own when it needs column sorting, server-side pagination, CSV export, or when cards get slow with more than about 100 items.

## 2026-10-20: Bun 1.4.2 Everywhere, Pinned in package.json

**Context:** The 2026-01-27 decision pinned Bun `1.3.11` in `apps/frontend/eas.json` and asked to keep the local environment aligned with it. Local development and CI had since moved to Bun `1.4.2`, which also wrote `bun.lock`, so EAS was the only place still on `1.3.11`.

**Decision:**

- Bun `1.4.2` is the single version: `packageManager` in the root `package.json` is the source of truth.
- CI (`oven-sh/setup-bun`) reads it from `package.json`; every `apps/frontend/eas.json` build profile sets `bun` and `node` explicitly.
- Node stays at `22.13.1` for EAS.
- When bumping Bun, change `packageManager` and the `apps/frontend/eas.json` profiles in the same commit, then run a development EAS build.

**Deno:** Edge Functions do not run on the local Deno CLI. `supabase functions serve` and deploys use the Supabase Edge Runtime, whose Deno major is declared in `supabase/config.toml` (`[edge_runtime] deno_version`). The local Deno CLI only serves the editor (LSP) and `deno check`, so its exact version is not pinned. On 2026-10-20 the runtime reported "supabase-edge-runtime-0.1.0 (compatible with Deno v2.1.4)" while the local CLI was 2.6.6: a local `deno check` can accept APIs the runtime lacks, so `supabase functions serve` is the real check.

## 2026-10-26: Commit the Supabase Stack Lock File

**Context:** Supabase CLI 2.122.0 writes `supabase/supabase.lock` in stack mode, pinning the image and digest of every local service, and adds its local files (`.link.json`, the lock lease) to `supabase/.gitignore`. The CLI release (supabase/cli#7195) says to commit the lock so every checkout and CI job runs the same builds whatever CLI version it has. The stack state saved by 2.121.0 could not be read by 2.122.0 and had to be deleted.

**Decision:**

- Commit `supabase/supabase.lock` and the CLI-maintained `supabase/.gitignore` entries. A later rewrite by `supabase start` goes in its own `chore` commit.
- The lock is unlinked (no `supabase link`): it pins the CLI's default builds, not the hosted project's versions.
- CI does not run the Supabase CLI today, so the frozen-lock behavior in CI does not apply yet.

## 2026-10-31: Node 24 LTS and Bun 1.4.4, Each With One Source of Truth

**Context:** Node `22.13.1` came from the 2026-01-27 decision. Its problem was misalignment: local Bun differed from EAS Bun. The fix was a fixed version written in `apps/frontend/eas.json`. Nothing tracked the pins afterwards. On 2026-10-31 EAS still built with Node `22.13.1` (January 2025, many security releases behind), local Node was `22.19.0`, and the repository had no Node file at all. `lint-staged` 17 needs Node `>=22.22.1`, so the stale pin started to block updates. Roadmap item #156, `odd/tasks/runtime-versions.md`.

**Decision:**

- Node `24.22.2` (LTS "Krypton", supported until 2028-04-30). `.nvmrc` is the source of truth. Bun `1.4.4`, with `packageManager` in the root `package.json` as the source of truth, as before.
- Every `apps/frontend/eas.json` profile repeats both versions, because EAS Build reads neither file. `scripts/guards/runtime-versions.test.ts` fails when a profile disagrees, so a bump cannot miss a copy.
- The dependency report workflow installs Node from `.nvmrc`. The other workflows run only Bun.
- Runtimes follow the update rule in `docs/dependencies.md`, "Keep Node and Bun current". This replaces "Node stays at `22.13.1` for EAS" from the 2026-10-20 entry.
- Node 26 became LTS on 2026-10-28. Move to it about three months later, near the Expo SDK 58 upgrade (#132).

## 2026-11-09: The `main` Ruleset Requires Up-to-Date Branches and Every CI Job

**Context:** The GitHub ruleset `main` already required a pull request and the `test` and `db-test` checks, with no bypass actors. It did not require a branch to be up to date with `main`. On 2026-11-09, #343 and #341 merged with CI runs that had never seen each other: #343 added a spec that used a DOM type, and #341 added a root type check without the DOM lib. `main` failed `bun run typecheck` until #347 fixed it.

**Decision:**

- The ruleset requires branches to be up to date before merging (`strict_required_status_checks_policy`).
- The required checks are every job in `.github/workflows/ci.yml`: `test`, `db-test`, `e2e`, and `commit-messages`. A new CI job is added to the ruleset when it lands.
- Pull requests still need no approving review, since the maintainer works alone.

**Consequence:** After a merge, an open pull request must be updated from `main` (`gh pr update-branch <N>`) and pass CI again before it can merge. With several parallel worktrees, merge one pull request at a time.

## 2026-11-09: Migrations Reach the Remote Through `supabase db push`

**Context:** Migrations were applied by hand in the SQL Editor, so the remote history listed 4 of 75 migrations and nothing showed which files were live. The Supabase GitHub integration failed on that gap on 2026-10-21 (`docs/go-live.md`, section 1). On 2026-11-09 (#301) the schema of a fresh `supabase db reset` was compared with the remote: every migration was already applied, and the only differences were privileges from archived pre-baseline migrations and a bucket deleted in the Dashboard.

**Decision:**

- The maintainer applies migrations with `supabase db push`, which records each version in the remote history. A file run in the SQL Editor also needs `supabase migration repair --status applied <version>`.
- The remote is the reference when a database rebuilt from migrations differs from it; the repository gets a migration that matches it (`20261109083744_local_privilege_parity`), and local tooling follows the remote privileges.
- `supabase/AGENTS.md`, "Schema drift check", is the check: the remote history must list every migration file, and `scripts/verify/schema-fingerprint.sql` must give the same rows locally and on the remote.

## 2026-11-10: The Agent Applies Migrations After the Maintainer's Green Light

**Context:** Since 2026-11-09 the maintainer ran `supabase db push` by hand after each merged migration. Each push was one more manual step for the maintainer, and the agent already had the commands, the dry run and the checks that follow. The root `AGENTS.md` already allowed applying a migration when the maintainer asks for that specific action.

**Decision (maintainer, 2026-11-10):**

- When a migration is merged, the agent asks for a green light naming each migration and what it changes, with the output of `supabase db push --dry-run --linked`.
- With the green light, the agent runs `supabase db push --linked` from the linked main checkout, then `bun run db:types` and the remote history check. The green light covers only the migrations it names; anything else in the dry run or the push stops the agent.
- First use: `20261111003504_checkout_recovery_reconciliation_state` (#383), applied 2026-11-10.
- Procedure: `supabase/AGENTS.md`, "When a change touches Supabase", steps 3 and 4. The entry above still holds: migrations reach the remote only through `supabase db push`.

## 2026-11-10: Database Types Come From the Local Database

**Context:** `bun run db:types` generated `packages/types/src/database.types.ts` from the remote project. The remote can hold work from an unmerged branch or miss an unapplied migration, so the committed types could disagree with `supabase/migrations/`, and nothing checked them (#304).

**Decision:**

- `bun run db:types` runs `scripts/dev/database-types.ts`: `supabase gen types typescript --local --schema public` after `supabase db reset`, formatted with the repository's Prettier and written only when generation succeeds. It does not reset the database itself, because a reset would delete local data and CI already catches stale types.
- The CI job `db-test` runs `bun run db:types:check`, which fails when the committed file differs from what the migrations generate.
- The types are generated with the migration and committed with it, before the push to the remote. This replaces "then `bun run db:types`" after the push in the 2026-11-10 entry above.

**Consequence:** The local generator is the `pgmeta` image pinned in `supabase/supabase.lock`, so a stack lock update can change the generated file; regenerate it in the same pull request. It is more precise than the remote one: generated columns are `never` on insert, NOT NULL JSON is `NonNullable<Json>`, and view columns take their nullability from the base tables.

## 2026-11-11: Client Grants Are Explicit Per Role

**Context:** The default privileges in `public` gave `anon` and `authenticated` every privilege on each new table and sequence, so only RLS protected 13 tables, and five functions kept EXECUTE for `PUBLIC` (#122, #305). The local database and the remote project had the same grants.

**Decision:**

- The `postgres` default privileges in `public` grant clients nothing on tables, sequences or functions; `service_role` keeps its defaults.
- Each table, view, sequence and function grants each client role exactly what the code uses today: the app and admin-web calls, and what RLS and storage policies evaluated for that role read or call. Calls that were already denied stay denied (#66, #178).
- `supabase/tests/database/client_grants.test.sql` and `supabase/tests/database/function_grants.test.sql` pin the exact lists, not upper bounds, so adding or removing a client grant is a deliberate change to the schema file and the test.

**Consequence:** A new table is invisible to clients until its file grants something, which is also the Supabase default for new projects since 2026-10-30. Some anon grants exist only because guests can reach signed-in flows (#434); they go when those flows are guarded.

## 2026-11-11: Client Supabase Key Variables Name the Publishable Key

**Context:** Supabase retires the legacy `anon` and `service_role` keys at the end of 2026 (#337). The apps read their key from `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`, and supabase-js accepts the new `sb_publishable_...` key in the same place.

**Decision:** The apps read `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Expo app) and `VITE_SUPABASE_PUBLISHABLE_KEY` (admin-web). No code reads the old names, and there is no fallback to them.

**Consequence:** The name says which key a client holds. An environment that still sets only the old name fails at startup, as a missing key does, instead of running on the anon key until the legacy keys are disabled. Every local `.env`, EAS environment and admin-web build env must set the new name (`docs/go-live.md`, "Moving an existing project to the new API keys").

## 2026-11-11: products_public Stays a SECURITY DEFINER View

**Context:** The Supabase security advisor reports `security_definer_view` (ERROR) on `public.products_public`, the view that buyers and guests read listings through (`supabase/migrations/20261024023415_products_public_view.sql`). The usual fix is `security_invoker = true`, so the view runs with the caller's rights and RLS on `products` applies (#306, `odd/tasks/internal-schema.md`, S7).

**Decision (maintainer, 2026-11-11):** `products_public` keeps running with its owner's rights. The advisor ERROR is an accepted finding in `docs/maintenance.md`.

**Reason:** A `security_invoker` view needs a row policy on `products` that lets every caller read public listings. Column grants are per role, not per row, and `authenticated` needs table-level SELECT on `products` so owners can read their own listings. With that row policy, any signed-in user could read the hidden columns of a public listing (`origin_zip`, the `verification_data` paths, the `publication_*` economics) straight from `products`. The view keeps those columns out because it lists only the columns a buyer needs, and `security_barrier` stops a caller's filter from running before its row predicate.

**Consequence:** A new `products` column stays hidden until someone adds it to the view. Revisit this entry if the view gains a column that only the owner should see.
