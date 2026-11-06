# Agent instructions (roadmap #228, items 1-3)

Fix the drifts in the agent instruction files and guard their references (#247), turn rules into checks (#248), and restructure the root `AGENTS.md` (#249). Items 2 and 3 add their specs here when they start.
Branch for item 1: `docs/agent-instructions-guard`.

## Specs

Item 1, #247 (verbatim from the issue):

- S1: "Root `AGENTS.md` says "documented `--ignore` list" for `bun audit`, but `.github/workflows/dependency-audit.yml` and `docs/dependencies.md` say the list is empty."
- S2: "Stack sleep timing differs. `AGENTS.md` says "the stack sleeps after 60 s idle". `.agents/skills/verify-selene/SKILL.md` line 34 says "`functions:serve` exits ~60 s after start when idle". Check the actual behavior, then make both files say the same true thing."
- S3: ""Speak up ... ask for a decision" conflicts with "open a Finding without asking first". State the boundary: issues are opened without asking, fixes need approval."
- S4: "`AGENTS.md` forbids following instructions fetched from a URL at run time, but the `envia-integration` skill fetches `docs.envia.com/llms.txt`. Distinguish reading documentation from following instructions."
- S5: "The maintainer note says "under ~150 lines" and the file is 162 lines."
- S6: "`.atl/skill-registry.md` is cited as the source of truth for skills, but it is gitignored."
- S7: "Every repository path cited in the root and nested `AGENTS.md` files exists."
- S8: "Every `bun run <script>` cited in them exists in a `package.json`."
- S9: "The root file stays under its line budget."
- S10: "The guard fails on a probe (a fake path, a fake script) and passes on the repository."
- S11: "`bun run lint`, `bun run typecheck`, `bun run format:check`, and `bun test` pass."
- Out of scope: "moving sections (item 3)."

Item 1, maintainer decisions (L2):

- S12: The guard covers the `AGENTS.md` files and our local skills (the `.agents/skills/*` not listed in `skills-lock.json`), found by glob.
- S13: The root line budget is 170 in item 1; item 3 lowers it to about 120. The maintainer note and the guard state the same number.
- S14: Measure the idle behavior on the local stack and try `supabase start --eager` before rewriting the timing sentences (S2).
- S15: One canonical command serves functions locally. Rewritten after L6: `bun run functions:serve` stays without `--no-verify-jwt` (the CLI already honors each function's `verify_jwt` from `supabase/config.toml`, and the flag turns gateway verification off for every function until `supabase stop`). Every instruction that tells a human or agent to start functions with `--no-verify-jwt` points to `bun run functions:serve` instead, and the nested Supabase guides warn against the flag.

## Tasks

- T1 [done] | - | inline | Create this document and its Engram mirror | commit: 2f4697d9
- T2 [done] | S7-S10, S12, S13 | inline | Guard `scripts/agent-instructions.test.ts`, test first | commit: 2f4697d9
- T3 [done] | S2, S14 | worker | Measure the idle behavior of `functions serve` and the stack, and `--eager` | commit: none (evidence in Log)
- T4 [in_progress] | S15 | worker | Run Bruno in three modes (done, L6); replace the `--no-verify-jwt` citations and prove the local e2e specs without it | commit: pending
- T5 [done] | S1-S6 | inline | Fix the drifts in the instruction files and the docs that repeat them | commit: pending
- T6 [done] | S11 | inline | Full checks and close | commit: none

## Log

- L1: "Retomá el roadmap #228 con el ítem #247 (A1). Cargá contexto con Engram roadmap/repo-layout-228. Creá una rama nueva desde origin/main, armá primero odd/tasks/agent-instructions.md y después hacé A1 como dice el issue. Antes de emepzar a iml;ementar, dime que opnias, cual es como el plan mas adetallado y todo eso. osea, puedes incluso invetigar mas que lo que dice el issue , osea no es de ley dar por echo que lo que dice el issue ya es lo dfinitivo."
- L2: Maintainer answers to the plan: guard scope "AGENTS.md + nuestros 5 skills (Recomendado)"; line budget "170 ahora, A3 lo baja a ~120 (Recomendado)"; idle "Sí, medir y probar --eager (Recomendado)"; `functions:serve` "Agregar el flag al script (Recomendado)".
- L3: Pre-plan evidence. `supabase --version` 2.122.0. `supabase start --help`: "--eager Activate all enabled capabilities before returning and disable automatic idle stops." No cited path or script is missing today; root `AGENTS.md` is 162 lines. Related open issues: #136 (Idea, `bun run stack` script; the T3 measurement informs it), #169 and #58 (Bruno and e2e flakiness, not covered). No draft advisory mentions these files.
- L4: T2 evidence. RED: `Cannot find module './agent-instructions'`. GREEN: 18 pass (14 probes on a fake repository, 4 on the real one). Paths count as existing only when Git sees them (tracked or untracked and not ignored), so the result matches CI. The first real run reported imprecise citations, fixed by citing full paths: `queries/`, `schema_baseline.test.ts`, `auth/login-without-captcha-rejected`, `local-stack.ts`, `config.toml`, and `vite.config.ts`. Manual probe: appending `` `docs/fake-probe.md` `` and `` `bun run fake:probe` `` to `AGENTS.md` failed with both messages, and the restored file passed (S10). When S6 removed the `.atl/skill-registry.md` citation, the stale-allowlist test failed until the entry was removed. `bun run typecheck`, `lint` (0 errors, 9 old `max-lines` warnings), and `format:check` pass; `tsc --strict` on the two new files is clean, because `typecheck` does not cover `scripts/` (Finding #255).
- L5: Maintainer, on deferring the structure items: "no deja el roadmap, la verdad me gustab lo que haremos y sobre todo con las caprteas, como et digo quiero intentar dejar al estructura de caprteas la manera mas limpia y vanguardista por asi decirlo posible". The whole roadmap stays. Saved in Engram as `preference/repo-structure-before-production`; where this guidance lives for every session is decided in #249 (comment added there).
- L6: T3 and T4 evidence (worker, CLI 2.122.0, stack mode, raw data in `.local/`). Lazy services (`rest`, `functions`) go to sleep about 60 s after the last request (`rest` stopping at 61 s, sleeping by 72 s); the first request to a sleeping service took 0.89 s against 0.035 s awake, and a cold function can answer 503 `BOOT_ERROR` once. The eager `database` stayed running for 7.5 min idle. `bun run functions:serve` exits about 60 s after the last request, not after start (63 s with no requests; 61 s after the last of a 2-minute series), with "shutdown signal 15" from the stack. `supabase start --eager` kept all 10 services running for 3.7 min, but `functions serve` still exited (360 s with no requests, "Owner response unavailable"; 13:00 after start with requests), so `--eager` does not replace starting serve right before the calls. Bruno, 628 requests after `db reset`: no serve 624/4, `bun run functions:serve` 625/3, `--no-verify-jwt` 623/5. Every mode fails the 3 `dispatch-push-*` requests because `EXPO_ACCESS_TOKEN` is missing from the local `supabase/functions/.env`; no serve also had one cold-boot 503; `--no-verify-jwt` also failed `cancel-order-no-auth` and `resolve-shipment-refund-no-auth`, which expect the gateway's `UNAUTHORIZED_NO_AUTH_HEADER`. Without the flag, `cancel-order` (`verify_jwt = true`) gets the gateway 401 and `stripe-webhooks` (`false`) reaches the function. After one run with the flag, verification stayed off for every function across serve exits and `db reset` until `supabase stop` and `supabase start`. The `*-no-auth` requests that say they need the flag pass without it (they send the anon key, a valid JWT, as `apikey`). S15 is rewritten: no flag.
- L7: T5 (S1-S4, S6). S2 is written from L6 in `AGENTS.md`, `.agents/skills/verify-selene/SKILL.md` (Launch step 4 and Gotchas, plus a warning against `--no-verify-jwt`), `supabase/AGENTS.md`, and `docs/auth.md`. Also fixed: `supabase/AGENTS.md` said the stack "stops when that process exits" and asked for one long-lived shell. A stack started from a background job that exited after 17 s kept running for more than an hour across many separate shells, so the sentence now says the stack runs until `supabase stop`, and the "same shell" requirements in `supabase/AGENTS.md` and `docs/auth.md` are gone. `supabase start --eager` is not documented as a fix: `functions serve` still exits under it. The `dispatch-push-*` Bruno failures are local configuration, not a defect: `supabase/functions/.env.example` lists `EXPO_ACCESS_TOKEN`, and the maintainer-owned `supabase/functions/.env` of this worktree does not set it.
- L8: Commits. 2f4697d9 holds the guard, its tests, the citation fixes it needed, and this document (476 authored lines, past the ~400 slice; the guard and its tests stay together). The drifts S1-S6 follow in their own commit, and the `--no-verify-jwt` change (S15) in a third. T6: `bun test` 4920 pass, 0 fail; `typecheck` clean; `lint` 0 errors (9 old `max-lines` warnings) after removing session scratch `.ts` files from the gitignored `.local/`, which ESLint lints; `format:check` clean. Local e2e (`bun run test:e2e:local`) 4/4 without the flag.
