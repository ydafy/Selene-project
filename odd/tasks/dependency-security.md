# Dependency security

Minimal, Selene-level dependency vulnerability monitoring, then a one-time fix of the current findings.
No automatic update PRs; alerts must stay actionable (a clean baseline before the weekly job can turn red).

## Specs

- S1: "vamos primero con Dependabot son tu setup" — Dependabot alerts enabled on GitHub (no version or security update PRs).
- S2: Agreed setup: a weekly non-blocking CI job runs `bun audit`, failing on high or critical, because Dependabot does not read `bun.lock` (transitive dependencies).
- S3: "y luego arrgelamos las vulnerabilidades de una vez." — triage the current `bun audit` findings, fix them, and document any accepted exception with its reason.

## Tasks

- [x] T1 (S1): Dependabot alerts on (L2).
- [x] T2 (S2): `.github/workflows/dependency-audit.yml` (0ec3a27), merged only together with T3 so it starts green.
- [x] T3 (S3): `bun audit fix` (e302615); `gentle-engram` removed (861d021); 6 build-tooling highs documented as `--ignore` in the workflow. L3, L6.
- [x] T4: `AGENTS.md` dependency-audit rule. `docs/go-live.md` unchanged (no secret, cron or Dashboard setting).

## Log

- L1: "okey me gusto, vamos primero con Dependabot son tu setup, y luego arrgelamos las vulnerabilidades de una vez."
- L2: `PUT repos/ydafy/Selene-project/vulnerability-alerts` -> 204; GET -> 204 (enabled). Dependency graph SBOM went from 404 to 117 packages (114 npm, 2 GitHub Actions); GraphQL manifests list only `package.json` files and `ci.yml` (no `bun.lock`, no `deno.lock`), so Dependabot sees direct dependencies only. `bun audit` reads `bun.lock` (1039 packages). `--audit-level` sets the exit code: `--audit-level=critical` with the two critical GHSAs ignored exits 0.
- L3: `bun audit fix` patched 16 within declared ranges (lockfile only): proxy-addr 2.0.8, shell-quote 1.11.0 (both critical), brace-expansion 1.1.21/2.1.7/5.0.12, source-map-js 1.2.2, fast-uri 3.1.8, vite 8.3.3. Verified: `bun test` 2157/2157, admin-web build and typecheck pass. 23 remain.
- L4: Remaining highs by path (`bun why`): braces 3.0.3 (no fix published; jest/babel via react-native), node-forge 1.4.0 (no fix published; @expo/cli), image-size 1.2.1 (metro range ^1.0.2), postcss 8.4.49 (@expo/metro-config ~8.4.32), undici 8.9.0 (only via `gentle-engram` -> `@earendil-works/pi-coding-agent`). None ship in the app bundle or run on a server with untrusted input. `gentle-engram` is in root `dependencies` since 1465741 (2026-05-26), imported by no file; `.pi/settings.json` is `{}`.
- L6: Maintainer chose "Sí, sacarlo" for `gentle-engram` and "Excepción documentada" for the remaining highs. After removal: 913 packages (was 1039), `@earendil-works/pi-coding-agent` gone from the lockfile. The workflow command exits 0 locally: "No vulnerabilities found (checked 913 packages, 7 below --audit-level=high, 6 ignored)". Ignored: GHSA-vfj7-8cjw-p6xm (braces), GHSA-86w9-cpqp-85rv (node-forge), GHSA-5p2g-fcmc-qvqq and GHSA-w3rx-r6r6-pgpr (image-size), GHSA-6g55-p6wh-862q and GHSA-r28c-9q8g-f849 (postcss 8.4). Review them on each Expo SDK upgrade. Follow-up suggestion from review: pin actions by SHA (not done).
- L5: Native review `review-13d5d18eae92bfad` (risk, resilience) approved and acknowledged. Advisories: pin actions by commit SHA (suggestion); the weekly job is red until the remaining highs are resolved or documented (expected, T3).
- L7: Expo SDK 57 upgrade (branch `chore/expo-sdk-upgrade`) re-checked the accepted exceptions, as the workflow comment asks on every SDK upgrade. `bun audit --audit-level=high` without ignores: `image-size` (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) and `postcss` 8.4 (GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849) no longer appear; `braces` (GHSA-vfj7-8cjw-p6xm) no longer appears even on `main`; `node-forge` 1.4.0 (GHSA-86w9-cpqp-85rv, via `@expo/cli` 57) still has no fix. Maintainer approved removing the five ("te doy permiso, arreglarlo"); only GHSA-86w9-cpqp-85rv stays ignored. The remaining highs are real and tracked: BL17 (Edge Function `zod` pin), BL18 (backend `body-parser`).
