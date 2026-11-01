# Pin GitHub Actions by commit SHA

Pin every `uses:` in `.github/workflows/` to a full commit SHA, make the weekly dependency report flag new action releases, and take the action majors available today.
Finding #172. Worktree `C:/dev/School-portal-worktrees/repo-hygiene`, branch `ci/pin-actions-sha` (from `origin/main` at e8c93d33).

## Specs

- S1: #172: "Pinning each action to a full commit SHA, with the tag in a comment (`uses: actions/checkout@<sha> # v4.x.y`), makes the code that runs fixed and reviewable."
- S2: The maintainer chose "Weekly report" to keep the pins current: the weekly dependency report gains a GitHub Actions section with the new releases per action. No automatic pull requests.
- S3: The maintainer chose "Include here" for the majors available today (`actions/checkout` v7, `actions/setup-node` v7, `supabase/setup-cli` v3): one commit per major in this PR, after reading each changelog.

## Tasks

- [x] T1 (S1): (fec141d4) pin the 11 `uses:` to the commit their tag or branch runs today, with a guard test and the rule in `docs/dependencies.md`.
- [ ] T2 (S2): GitHub Actions section in `scripts/dependency-report.ts`, test-first.
- [ ] T3 (S3): `actions/checkout` v7.
- [ ] T4 (S3): `actions/setup-node` v7.
- [ ] T5 (S3): `supabase/setup-cli` v3.

## Log

- L1: "abre lo de la idea me gusta y sineto que lo terminaremos haciendo en este woktree,, y si, dale con lo de node 24, y bun como una funete de verdad y depeus tomas #130" — the idea already existed as Finding #172, and #156 and #130 were already closed (PRs #159 and #170); no duplicate issue opened. Then "si sigue master" to take #172 here.
- L2: State on 2026-11-01. `@v4`, `@v2` and `@v1` resolve to: `actions/checkout` v4.4.0 `11d5960a326750d5838078e36cf38b85af677262`, `oven-sh/setup-bun` v2.2.0 `0c5077e51419868618aeaa5fe8019c62421857d6`, `denoland/setup-deno` v2.0.5 `22d081ff2d3a40755e97629de92e3bcbfa7cf2ed` (`v2` is a branch), `supabase/setup-cli` v1.7.3 `1dedf2c611547ede7232d26866dd3c56ab903bbb` (`v1` is a branch), `actions/setup-node` v4.4.0 `49933ea5288caeca8642d1e84afbd3f7d6820020`. Latest releases: checkout v7.0.1, setup-node v7.1.0, setup-cli v3.0.1, setup-bun v2.2.0, setup-deno v2.0.5.
- L3: T1: RED `scripts/workflow-actions.test.ts` failed on `ci.yml:22` (`actions/checkout@v4`), GREEN after pinning the 11 `uses:` (4 pass). Each pin is the commit the old tag or branch resolved to, so what CI runs does not change; the PR's CI run proves the SHAs resolve. `dependency-report.yml` and `issue-labels.yml` cannot be run from the branch without side effects or at all; check them after the merge.
- L4: Native review `review-ad2a21ed95145111` (risk, reliability) on fec141d4: approved and acknowledged. Advisories for T2: R3 (warning) `parseActionUses` skips a `uses:` without `@` (a local `./` action or an unpinned `owner/repo`), so the guard would not flag it; R1 the tag comment is not checked against the SHA (the weekly report can resolve it); R3 the "shared by the report" comment is true only after T2.
- L5: "master cuando termines t1 paras y me comentas que hiciste porfa" — stopped after T1; T2 to T5 wait for the maintainer.
