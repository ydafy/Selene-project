# Group scripts/ by purpose (#251)

Item 5 of roadmap #228: move the flat files in `scripts/` into four folders by purpose and update every reference, in one move-only commit. Worktree `repo-hygiene`, branch `chore/scripts-layout`.

## Specs

- S1. "Move the files into `scripts/dev`, `scripts/ci`, `scripts/guards`, and `scripts/verify`" (L2): `dev` holds `bruno-env`, `stripe-listen`, `worktree-env`, `worktree-clean`, `codegraph-refresh.sh`; `ci` holds `check-commit-msg`, `dependency-report` with `fixtures/`, `workflow-actions`, `dependency-audit-exceptions.test`; `guards` holds `agent-instructions`, `script-paths`, `markdown-placement`, `source-text-tests`, `test-placement`, `test-only-guard`, `runtime-versions`, `edge-function-npm-pins`; `verify` holds the 22 harnesses and `postgres-smoke`. Each test moves with its script.
- S2. "update every reference in the same commit." `odd/tasks/*.md` logs keep their historical paths.
- S3. "When a test fails after the move, fix its path. Do not delete it, weaken it, or convert it in the move commit."
- S4. "Out of scope: changing harness behavior, adding harnesses to CI (#226), a shared repo-root helper."
- S5. "The hooks still work (a bad commit message is rejected)."
- S6. "The test count is unchanged."
- S7. "The guards from items 1 and 4 pass."
- S8. "Harness `--help` text shows the new paths."

## Tasks

- T1 | S1-S4, S8 | inline | `git mv` into the four folders; fix repository-root resolution, sibling imports, spawned paths, `--help` text, and every citation outside `odd/`; `docs/conventions.md` "Repository scripts" | commit: this commit (done)
- T2 | S5-S7 | inline + verify | full suite count against the baseline, lint, typecheck, format:check, knip, a rejected bad commit message through the hook; independent verifier (Risk item 5: hooks and CI) | 4995 pass before and after; lint 0 errors; typecheck, format:check, knip clean; `git commit -m "moved some scripts"` rejected by the commit-msg hook; old paths reverted in `docs/worktrees.md` and `package.json` fail the two guards | commit: this commit (done; checked inline and by the independent verifier, see L4-L5)

## Log

- L1. User (2026-11-07): "Seguimos con el roadmap #228: toca #251 (ítem 5, reorganizar scripts/ en dev/ci/verify). Cargá Engram: roadmap/repo-layout-228, odd/runbooks-home/tasks y preference/repo-structure-before-production. Traé lo último de main en este worktree (repo-hygiene), en una rama nueva. Antes de arrancar, revisá que el issue siga vigente y decime si cambiarías algo."
- L2. Recheck (2026-11-07): `scripts/` has 61 top-level files plus 9 fixtures, not 49; 104 citing lines in 52 files outside `scripts/` and `odd/`, not about 80; 8 repository guards added since the issue fit none of dev, ci, verify; 12 more tests than the issue's seven resolve the repository root with `'..'`; no config globs `scripts/`. The maintainer chose four folders (`dev`, `ci`, `guards`, `verify`; no `hooks/`) and an updated issue body (done).
- L3. Move (2026-11-07): one sed pass turned `join(import.meta.dir, '..')` into three `'..'` (the second rule matched its own output); 11 files, among them 8 guards, resolved the parent of the worktree. Four guards failed loudly on `git ls-files`; fixed before commit. Lint's 9 warnings are in untouched admin-web and frontend files.
- L4. Verification (2026-11-07): the runtime did not admit the independent verifier because the launch text lacked a `Risk: item N` line; it was not relaunched. The same checks ran inline: no flat `scripts/<file>` path remains outside `odd/` (only the guards' deliberate nonexistent fixtures), every root resolution uses `'..', '..'`, `--help` prints `bun scripts/verify/<name>.ts`, the diff outside paths is the new conventions section, this document, and Prettier realigning one table in `docs/specs/shipment-cancellation-coordination.md`.
- L5. After `gentle_review assess` escalated item 5, the independent verifier ran read-only on 7f0c76df: S1-S8 met, 4995 pass, guards 67 pass, no blockers or advisories. Native review did not start: `lens_context_budget_exceeded` (renames count as full delete plus add, about 39,700 lines); retrying the same candidate cannot succeed. Verifier suggestion: a `scripts/guards/script-folders.test.ts` guard that fails on a file outside the four folders.
- L6. User (2026-11-07): "hagamos la opcion 2 ' Desactivar la revisión nativa en este clon' pero olo para esto, una ves lo hagamos la volvemos activar para que qeede como antes". `gentle-ai review mode disable --scope clone` then `enable --scope clone`; status is back to "on (decided by default)", clone-local unset. This commit stays without native review.
