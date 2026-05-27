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
- Bun `1.3.0`
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
- Bun `1.3.0`
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
