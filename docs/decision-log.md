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

- Align local environment with `eas.json`.

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

## 2026-10-20: Bun 1.4.2 Everywhere, Pinned in package.json

**Context:** The 2026-01-27 decision pinned Bun `1.3.11` in `eas.json` and asked to keep the local environment aligned with it. Local development and CI had since moved to Bun `1.4.2`, which also wrote `bun.lock`, so EAS was the only place still on `1.3.11`.

**Decision:**

- Bun `1.4.2` is the single version: `packageManager` in the root `package.json` is the source of truth.
- CI (`oven-sh/setup-bun`) reads it from `package.json`; every `apps/frontend/eas.json` build profile sets `bun` and `node` explicitly.
- Node stays at `22.13.1` for EAS.
- When bumping Bun, change `packageManager` and the `eas.json` profiles in the same commit, then run a development EAS build.

**Deno:** Edge Functions do not run on the local Deno CLI. `supabase functions serve` and deploys use the Supabase Edge Runtime, whose Deno major is declared in `supabase/config.toml` (`[edge_runtime] deno_version`). The local Deno CLI only serves the editor (LSP) and `deno check`, so its exact version is not pinned. On 2026-10-20 the runtime reported "supabase-edge-runtime-0.1.0 (compatible with Deno v2.1.4)" while the local CLI was 2.6.6: a local `deno check` can accept APIs the runtime lacks, so `supabase functions serve` is the real check.

## 2026-10-26: Commit the Supabase Stack Lock File

**Context:** Supabase CLI 2.122.0 writes `supabase/supabase.lock` in stack mode, pinning the image and digest of every local service, and adds its local files (`.link.json`, the lock lease) to `supabase/.gitignore`. The CLI release (supabase/cli#7195) says to commit the lock so every checkout and CI job runs the same builds whatever CLI version it has. The stack state saved by 2.121.0 could not be read by 2.122.0 and had to be deleted.

**Decision:**

- Commit `supabase/supabase.lock` and the CLI-maintained `supabase/.gitignore` entries. A later rewrite by `supabase start` goes in its own `chore` commit.
- The lock is unlinked (no `supabase link`): it pins the CLI's default builds, not the hosted project's versions.
- CI does not run the Supabase CLI today, so the frozen-lock behavior in CI does not apply yet.
