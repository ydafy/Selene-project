# Workflow lint in CI

Roadmap #623, item 6: #629. actionlint and zizmor check `.github/workflows/` on every CI run in a new `repo-checks` job. gitleaks is not added: GitHub secret scanning and push protection already cover this public repository (L3).

## Specs

- S1. The 11 zizmor 1.32.0 findings on `main` (calibration, L2) are fixed, not accepted: `issues: write` in `.github/workflows/dependency-report.yml` moves from the workflow level to the `report` job, and every `actions/checkout` step sets `persist-credentials: false`. zizmor then reports 0 findings, so there is no exceptions file.
- S2. actionlint 1.7.12 runs with shellcheck (preinstalled on `ubuntu-latest`). Its one finding on `main`, SC2035 on `deno check --frozen */index.ts` in `ci.yml`, is fixed in the workflow.
- S3. A new job `repo-checks` in `.github/workflows/ci.yml` downloads the linux release binaries of actionlint and zizmor, each pinned by exact version and sha256 in the workflow and checked with `sha256sum -c` before use, then runs `actionlint` and `zizmor` online with `GH_TOKEN: ${{ github.token }}`. The zizmor step also runs after an actionlint failure. The job has `contents: read` only and no other secret. The actionlint sha256 matches its release checksums file; the zizmor sha256 matches the asset digest of its release (marked immutable).
- S4. `docs/dependencies.md` says how to bump the two tools (version and sha256); `docs/decision-log.md` records why gitleaks is not added and that `repo-checks` joins the required checks of the `main` ruleset (the maintainer adds it).
- S5. Version tracking of the pinned binaries is #687, not this feature.

## Tasks

- [x] T1 (S1, S2): workflow fixes. Route: `gentle-ai-worker`. Commit: 2d21353c
- [x] T2 (S3, S4): `repo-checks` job and docs. Route: `gentle-ai-worker`. Commit: see L5
- [ ] T3: independent verification (Risk: item 5, CI). Route: `gentle-ai-verify`, no workspace copy. Evidence: pending

## Log

- L1. Original request (maintainer, 2026-11-17), verbatim: "Arranquemos el último ítem del roadmap #623: #629 (actionlint, zizmor y gitleaks en CI). Lo que hay que hacer está en el issue y en Engram (topic `roadmap/test-layers`), así que no te lo repito. Leelos y, como siempre, decime qué opinás del issue antes de seguirlo al pie de la letra. Como cambia CI, primero proponeme el cambio concreto y esperá mi aprobación antes de escribir código. Trabajá en un worktree nuevo bajo C:/dev/School-portal-worktrees/." The request also listed lessons from the previous session: calibrate before blocking, each exception with its reason in a file with a stale-entry check, check GitHub secret scanning and `scripts/guards/migration-credential-scan.ts` before adding gitleaks, actions pinned by SHA, binaries pinned by exact version and checksum, a new job goes into the `main` ruleset (the maintainer does it).
- L2. Calibration on `origin/main` 517b7637: actionlint 1.7.12, 0 findings without shellcheck, 1 with shellcheck 0.11.0 (SC2035, `ci.yml:43`); zizmor 1.32.0, offline and online the same: 1 `excessive-permissions` (`dependency-report.yml:19`) and 10 `artipacked`; gitleaks 8.30.1, 1 false positive in tracked files and 10 in history, none new (truncated session-token prefixes and an idempotency key in an old `logs.md`, the Android keystore passwords already retired in `docs/go-live.md`, a test idempotency key).
- L3. Maintainer decision (2026-11-17): drop gitleaks. Research: zizmor runs in CI at vercel/vercel, supabase/supabase, astral-sh/uv and ruff, python/cpython and grafana; none of 18 reference repositories runs gitleaks (grafana runs trufflehog); the rest rely on GitHub secret scanning, free on public repositories over the whole history. In a public repository CI runs after the push already published a secret, so only push protection prevents exposure, and it is on. The maintainer will check whether "Generic patterns" can be enabled in Settings > Advanced Security.
- L4. Idea #687 (maintainer's request): the weekly dependency report tracks pinned tool binaries; revisit in the routine of Monday 2026-11-23.
- L5. T1 and T2 checks (worker, 2026-11-17): actionlint with shellcheck 0.11.0 exit 0; zizmor online "No findings to report" (15 suppressed, pedantic persona only); `bun test scripts/ci/workflow-actions.test.ts scripts/ci/dependency-report.test.ts scripts/guards` 233 pass; prettier clean; `deno check --frozen ./*/index.ts` checks the same 44 files. RED: a scratch workflow with `run: echo ${{ github.event.issue.title }}` fails actionlint (exit 1) and zizmor `template-injection` (exit 14); `sha256sum -c` with a wrong hash fails. The install step ran under git-bash with a simulated `RUNNER_TEMP`. Not yet proven: the job on a real `ubuntu-latest` runner.
