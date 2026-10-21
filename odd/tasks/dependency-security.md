# Dependency security

Minimal, Selene-level dependency vulnerability monitoring, then a one-time fix of the current findings.
No automatic update PRs; alerts must stay actionable (a clean baseline before the weekly job can turn red).

## Specs

- S1: "vamos primero con Dependabot son tu setup" — Dependabot alerts enabled on GitHub (no version or security update PRs).
- S2: Agreed setup: a weekly non-blocking CI job runs `bun audit`, failing on high or critical, because Dependabot does not read `bun.lock` (transitive dependencies).
- S3: "y luego arrgelamos las vulnerabilidades de una vez." — triage the current `bun audit` findings, fix them, and document any accepted exception with its reason.

## Tasks

- [x] T1 (S1): Dependabot alerts on (L2).
- [ ] T2 (S2): `.github/workflows/dependency-audit.yml`, merged only together with T3 so it starts green.
- [ ] T3 (S3): triage and fix the 37 findings.
- [ ] T4: docs (`AGENTS.md` command, `docs/go-live.md` if needed).

## Log

- L1: "okey me gusto, vamos primero con Dependabot son tu setup, y luego arrgelamos las vulnerabilidades de una vez."
- L2: `PUT repos/ydafy/Selene-project/vulnerability-alerts` -> 204; GET -> 204 (enabled). Dependency graph SBOM went from 404 to 117 packages (114 npm, 2 GitHub Actions); GraphQL manifests list only `package.json` files and `ci.yml` (no `bun.lock`, no `deno.lock`), so Dependabot sees direct dependencies only. `bun audit` reads `bun.lock` (1039 packages). `--audit-level` sets the exit code: `--audit-level=critical` with the two critical GHSAs ignored exits 0.
