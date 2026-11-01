# Dependencies

When to update a dependency, how to do it without breaking the app, and when to leave it alone.
The commands run from the repository root. The Expo SDK procedure lives in `odd/tasks/expo-sdk-upgrade.md`.

## Treat each version change by its semver level

A version number reads `major.minor.patch`. The level tells you how much to trust the change.

| Level | Example            | What changes                      | How to treat it                                                                        |
| ----- | ------------------ | --------------------------------- | -------------------------------------------------------------------------------------- |
| Patch | 5.104.5 to 5.104.6 | Bug and security fixes only       | Update with the other in-range updates. Run the checks.                                |
| Minor | 5.104 to 5.105     | New features, backward compatible | Update with the other in-range updates. Read the release notes for deprecations.       |
| Major | 8.x to 9.x         | Breaking changes allowed          | One major per commit. Read the changelog first and fix every breaking change it lists. |

A package below `1.0.0` can break on a minor. Treat its minor like a major.

## Follow the cadence

- **Weekly, automatic.** The `Dependency audit` workflow (`.github/workflows/dependency-audit.yml`) runs `bun audit --audit-level=high` every Monday. It fails on high or critical vulnerabilities.
- **Monthly, by hand.** Run `bun outdated --filter @selene/frontend` and `bun outdated --filter admin-web`. Update the in-range updates together in one commit. Update each major in its own commit after reading its changelog. Check Node and Bun too ("Keep Node and Bun current").
- **Expo SDK, 4 to 8 weeks after a release.** Upgrade one SDK at a time, in its own worktree. Merge to `main` only when the whole upgrade passes. Follow `odd/tasks/expo-sdk-upgrade.md` and run its device checklist (L12, updated by L21) on a new development build.

**The weekly report does the looking for you.** The `Dependency report` workflow (`.github/workflows/dependency-report.yml`) runs every Monday after the audit. It runs `bun scripts/dependency-report.ts` and writes the result into one open issue, **Reporte de dependencias**, then comments a one-line summary so you get an email. The report lists safe updates, majors with changelog links, majors held back on purpose with the reason, the Expo SDK status, packages off the SDK, Expo-pinned packages with a newer major (they move with the SDK upgrade, not one by one; the pin list is `apps/frontend/node_modules/expo/bundledNativeModules.json`), the Node and Bun runtimes, and the audit. It never opens pull requests. Run the script locally for the same report, or start the workflow from the **Actions** tab.

When you hold a major back, add it to `HELD_BACK` in `scripts/dependency-report.ts` with its reason, and write the case in "When not to update" below. Remove the entry when the blocker is gone.

## Keep Node and Bun current

Node and Bun run all the tooling: Expo CLI, EAS Build, ESLint, the Git hooks, and the scripts. Each release carries security fixes, and libraries raise their minimum runtime over time, so a stale runtime blocks other updates.

Each runtime has one source of truth:

| Runtime | Source of truth                    | Copies                                    |
| ------- | ---------------------------------- | ----------------------------------------- |
| Node    | `.nvmrc` (exact version)           | every profile in `apps/frontend/eas.json` |
| Bun     | `packageManager` in `package.json` | every profile in `apps/frontend/eas.json` |

The weekly report's **Runtimes** section applies these rules. It flags a newer patch of the pinned Node line (and says when it is a security release), a line that ends within six months, a new LTS line once it is about three months old, and a new Bun release once it is 3 days old.

CI reads Bun from `packageManager` through `oven-sh/setup-bun`. The dependency report workflow reads Node from `.nvmrc`. EAS Build reads neither, so `scripts/runtime-versions.test.ts` fails when an `eas.json` profile disagrees.

Follow these rules:

- **Node.** Use an LTS line (even major: 22, 24, 26). Take the latest patch of that line every month. Move to a new LTS line about three months after it becomes LTS (dates in the [Node.js release schedule](https://github.com/nodejs/Release)), and before the current line ends. Never use an odd major: it has no long-term support.
- **Bun.** Take the latest release every month. `bunfig.toml` keeps the 3-day minimum age for packages. Apply the same wait to Bun itself.

To change a runtime version:

1. Change the source of truth and every `eas.json` profile in the same commit. Run `bun test scripts/runtime-versions.test.ts`.
2. Switch your local runtime. For Node with nvm-windows, which does not read `.nvmrc`, run `nvm install <version>`, then `nvm use <version>`. For Bun, run `bun upgrade`, or `bun upgrade --version <version>` for an exact one.
3. Run the checks in "Update without breaking things", then a development EAS build.

## Keep GitHub Actions pinned

A workflow runs third-party actions with the job token. A tag such as `v4` can be moved to other code at any time, so every `uses:` in `.github/workflows/` points to a full commit SHA, with the exact release tag in a comment:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

`scripts/workflow-actions.test.ts` fails when a `uses:` has no SHA or no exact tag, or when two workflows pin the same action differently.

To change an action version:

1. Read its release notes. A new major gets its own commit.
2. Resolve the tag to its commit. The `commits` endpoint also resolves annotated tags, which `git/ref` returns as tag objects:

   ```bash
   gh api repos/<owner>/<action>/commits/<tag> --jq .sha
   ```

3. Replace the SHA and the comment in every workflow that uses the action, and run `bun test scripts/workflow-actions.test.ts`. CI on the pull request runs `ci.yml`. Start `dependency-audit.yml` on the branch with `gh workflow run dependency-audit.yml --ref <branch>`. `dependency-report.yml` also edits the report issue, and `issue-labels.yml` runs only from `main`, so check those two after the merge.

## Move Expo-pinned packages only with Expo

Each Expo SDK pins the versions of its native packages (`expo-*`, `react-native`, `react-native-reanimated`, and others, pinned in `apps/frontend/package.json`). Do not bump them with `bun update` or by editing `package.json`.

1. Run `npx expo install --fix` from `apps/frontend`, never from the root. Running it at the root breaks native autolinking.
2. Run `npx expo install --check` from `apps/frontend` to list packages that do not match the installed SDK.

## Check before you add a dependency

Answer these before running `bun add`. If an answer is bad, do not add the package.

1. Who maintains it? A single inactive maintainer is a risk.
2. When was the last release? A package with no release in a year probably does not follow React Native.
3. Does it support the New Architecture? Check its entry on reactnative.directory. The New Architecture is the only option in the current SDK.
4. Can we avoid it? A small helper in our code costs less than a dependency we must track.
5. Can we wrap it? Put it behind our own component or module, so replacing it changes one file. `AppImageViewer` in `apps/frontend` wraps the photo viewer this way.

## Update without breaking things

1. Start from a clean working tree on a feature branch.
2. Read the changelog of every major before you change it.
3. Change one major per commit. Update the in-range packages in a separate commit.
4. Run the checks from `AGENTS.md`, "Verifying a change":
   - `bun run lint`
   - `bun run typecheck`
   - `bun test`
   - `bun audit --audit-level=high` with the `--ignore` list from `.github/workflows/dependency-audit.yml`
   - A device check when the package is native (see the Expo SDK rule above).
5. Commit only when every check passes.

`bunfig.toml` sets `minimumReleaseAge = 259200` (3 days). Bun refuses to install a version published less than 3 days ago. If an install fails for that reason, pick the previous version. Never change the setting.

## Fix one indirect package

An indirect package (one that only reaches us through another package, such as `node-forge` through `@expo/cli`) sometimes needs a fixed version right away, usually for an advisory. Deleting its line from `bun.lock` and running `bun install` also refreshes hundreds of unrelated in-range packages, which do not belong in a security change. Change only that package's entry instead:

1. Check that the fixed version fits the range the dependent declares (`bun pm why <name>` shows the range). If it does not, the fix waits for a release of the dependent, or becomes an exception (see "An override would be unsafe" below).
2. Read the fixed version's `integrity` from `https://registry.npmjs.org/<name>/<version>`.
3. In `bun.lock`, replace the version and the `sha512-...` hash on that package's line. Leave every other line alone.
4. Run `bun install --frozen-lockfile`. It fails if the lockfile is inconsistent.
5. Run the checks in "Update without breaking things". If the fix clears an advisory that has an `--ignore`, remove the flag and its comment from `.github/workflows/dependency-audit.yml`.

PR #147 (node-forge 1.4.0 to 1.4.2) followed these steps. The unrelated in-range updates go into the monthly update commit.

## When not to update

Updating is the default. Leave a package alone only for a reason you can write down, and write it down. This repository has two such cases.

### A tool we depend on excludes the new major

TypeScript 7.0 is `latest` on npm, but this repository stays on TypeScript 6.0.3 (`~6.0.3` in `package.json`, `apps/frontend/package.json`, and `apps/admin-web/package.json`). Two facts block the upgrade:

- TypeScript 7.0 ships no programmatic compiler API. The API arrives in 7.1.
- `typescript-eslint` 8.72.1, the latest release, declares the peer range `typescript >=4.8.4 <6.1.0`. It does not accept 7.

Without the API and without a compatible `typescript-eslint`, `bun run lint` would stop working. The evidence is in `odd/tasks/repo-hygiene.md`, L20 and L21.

The general rule: a major is blocked when a tool we depend on declares a peer range that excludes it. Check the peer ranges of the tools that load the package (`bun pm ls` and the tool's `package.json`). Wait for a release of that tool that accepts the new major, then upgrade.

### An override would be unsafe

`decode-uri-component` 0.2.2 reaches the app through `expo-router` and `query-string` 7.1.3. It has an advisory (`GHSA-qr28-fpjm-wq7f`): a crafted deep link can make the decode slow on the user's own device. No server or money path is involved. The fixed version, 0.5.1, is ESM-only and outside the `^0.2.2` range that `query-string` 7 declares. Forcing it with an override could break the Metro bundle (issue #81, PR #92).

So the audit accepts it:

- `.github/workflows/dependency-audit.yml` passes `--ignore=GHSA-qr28-fpjm-wq7f` and states the reason in a comment.
- `scripts/dependency-audit-exceptions.test.ts` fails if the exception would also hide another copy of the package.

The general rule: when an override is unsafe, accept the finding with a written reason in the workflow, add a guard test that limits what the exception hides, and review the exception on every Expo SDK upgrade. Drop the `--ignore` once a fixed version fits the dependent's range. Never add an `--ignore` without its reason in the workflow file.
