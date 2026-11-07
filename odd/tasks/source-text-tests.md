# Source-text tests plan (#226)

Research for #226: recount the tests that read source files as text (#138), sort them by area and kind, say what the moves in #250, #251, #221, and #252 must do about them, and plan the conversion as its own roadmap. No code changes in this item.
Branch: `docs/source-text-tests-plan`. Roadmap: #272 (items #273 to #278).

## Specs

From #226 (verbatim):

- S1: "count them again after #134"
- S2: "sort them by area and by kind (wiring checks that should mount a screen, logic checks that should call a function, SQL checks that should run against the local PostgreSQL harness, and the few where text is the contract)"
- S3: "write `odd/tasks/source-text-tests.md` with one roadmap item per area, starting where money moves."
- S4: Rewritten after L6. The items go into a separate roadmap, not into #127 (#226 said "Then add those items to #127.").
- S5: "Close it with `Closes #226` in its PR."

From the maintainer (L1, verbatim):

- S6: "Es una sesión de investigación, sin cambios de código."
- S7: "Va antes de #250, #251 y #221 porque esos mueven archivos que estos tests leen. Lo que salga de acá tiene que decirme qué hacer antes o durante esos moves."
- S8: "El conteo era 253 archivos (266 si se cuentan los que leen JSON, YAML o logs). Volvé a contarlo; seguro cambió."
- S9: "Las carpetas \_\_tests\_\_ viejas se van en #250 (packages/types), #252 (supabase/functions) y después de #226 (supabase/queries, migrations). El guard obliga a sacar cada entrada del allowlist."
- S10: "Clasificá todo en must-have, nice-to-have y overengineering. Los nice-to-have van como Idea."
- S11: "Antes de proponer un plan, decime qué opinás. No des por hecho que el issue es definitivo."

## Tasks

| ID  | Specs       | Route                                          | Status | Commit                                                     |
| --- | ----------- | ---------------------------------------------- | ------ | ---------------------------------------------------------- |
| T1  | S1, S2, S8  | Inline count, two read-only explorers          | done   | this document                                              |
| T2  | S7, S9      | Explorer, inline spot checks                   | done   | this document                                              |
| T3  | S10, S11    | Inline, maintainer decisions L6 and L8         | done   | this document                                              |
| T4  | S3          | Inline                                         | done   | this document                                              |
| T5  | S3, S4, S10 | Inline: roadmap parent, six items, one Idea    | done   | #272, #273 to #278, Idea #279                              |
| T6  | S7          | Inline: edit #250, comment on #251, #221, #252 | done   | #250 body and comments; comments on #226, #127, #228, #138 |

## Log

- L1 (maintainer, 2026-11-06, verbatim):

  > eguimos con el roadmap #228: toca #226 (investigar cómo dejar de usar tests que leen el código fuente como texto). Es una sesión de investigación, sin cambios de código. Todo el alcance está en el issue.
  >
  > Cargá Engram: roadmap/repo-layout-228, odd/agent-instructions/tasks y preference/repo-structure-before-production. Traé lo último de main en este worktree (repo-hygiene).
  >
  > Lo que no está en el issue:
  >
  > - Va antes de #250, #251 y #221 porque esos mueven archivos que estos tests leen. Lo que salga de acá tiene que decirme qué hacer antes o durante esos moves.
  > - El conteo era 253 archivos (266 si se cuentan los que leen JSON, YAML o logs). Volvé a contarlo; seguro cambió.
  > - Las carpetas \_\_tests\_\_ viejas se van en #250 (packages/types), #252 (supabase/functions) y después de #226 (supabase/queries, migrations). El guard obliga a sacar cada entrada del allowlist.
  > - Clasificá todo en must-have, nice-to-have y overengineering. Los nice-to-have van como Idea.
  >
  > Antes de proponer un plan, decime qué opinás. No des por hecho que el issue es definitivo.

- L2 (evidence, count at `528446af`). There are 481 tracked test files. 269 of them read files, and 257 read source or SQL text. The other 12 read only JSON fixtures (10) or check output that the code under test wrote (2). It was 244 in #138 and 253 (266) on 2026-11-05, so the number keeps growing. Regenerate the count:

  ```bash
  git ls-files '*.test.ts' '*.test.tsx' | xargs grep -lE "readFileSync|Bun\.file\(|readFile\(" | wc -l
  ```

  | Area                  | Files that read files |
  | --------------------- | --------------------- |
  | `supabase/migrations` | 95                    |
  | `apps/frontend`       | 75                    |
  | `supabase/functions`  | 63                    |
  | `supabase/queries`    | 16                    |
  | `scripts`             | 15                    |
  | `apps/admin-web`      | 3                     |
  | `packages/types`      | 1                     |
  | `supabase/templates`  | 1                     |

- L3 (evidence, kind). Estimate from directory patterns, import lines, and assertion shapes, not a per-file pass. Of the 255 files that read TypeScript or SQL, about 80 are wiring checks, 24 logic checks, 56 SQL checks, and 95 contracts where the text is what the test means to check. About 41 files mix behavior tests with text assertions.
  - The SQL target in S2 is wrong. `docs/postgres-test-harness.md` starts an empty PostgreSQL that loads no `supabase/` SQL, and only the `scripts/test-shipment-*-coordination` harnesses use it. SQL behavior is proven by pgTAP: `bun run test:db` (`supabase test db`) runs `supabase/tests/database/*.test.sql` (12 files, 2,316 lines), and CI runs it in the job `db-test`. The pgTAP files build their fixtures with `pg_temp` helpers, for example `supabase/tests/database/release_callers.test.sql`.
  - Most Edge Function wiring checks exist because importing an `index.ts` starts a Deno server (`supabase/functions/stripe-webhooks/connect-payout-attach-adapter.test.ts:4-5`). Functions that already split a `handler.ts` are tested by calling it with fake dependencies (`supabase/functions/envia-webhook/handler.test.ts`).
  - Money code with only source-text tests and no behavior test next to it: `stripe-webhooks/connect-payout-attach-adapter`, `stripe-webhooks/connect-payout-terminal-adapter`, `complete-delivered-shipments`, and `create-dispute`, plus about 45 money migration tests (payouts, refunds, settlement, fee reconciliation) and 5 query guards (`connectMoneyFlowGuards`, `payout-release-amount-contract`, `shipmentCancelSafetySqlGuards`, `singleModalSettlementSqlGuards`, `checkoutRecoverySqlGuards`).
  - No shared whitespace helper exists. About 60 test files inline their own `.replace(/\s+/g, ' ')`.

- L4 (evidence, coupling to the moves). A move breaks most of these tests loudly: the read throws on a missing file, or `toContain` stops matching an import path. The guard `scripts/test-placement.ts` (`LEGACY_TEST_FOLDERS`, 10 entries) fails when a listed folder no longer exists, so each removal is enforced. What each move must do:
  - #250: `packages/types/src/confirmShipmentContracts.test.ts:3` reads `./types.ts` by a sibling path. The three `packages/types/src/__tests__` tests use imports only.
  - #251: seven `scripts/*.test.ts` files read or spawn a script by path. Four use a repository-root path (`postgres-smoke`, `test-shipment-cancellation-coordination`, `test-shipment-transfer-coordination`, `codegraph-refresh`) and three a sibling path (`check-commit-msg`, `worktree-clean.cli`, `dependency-report` with its `fixtures/`). Move each test with its script. 16 tests cite a `scripts/` harness only in a comment (15 in `supabase/migrations/__tests__/shipment_*` and `supabase/functions/__tests__/autoCancelLabelDeadlineReminder.test.ts:6`). Nothing fails when those comments go stale, so update them in the move commit. `scripts/test-shipment-*-coordination.test.ts` assert `exitCode` 1 and an exact stderr, so a missing script still fails them (checked).
  - #221: `apps/admin-web/src/components/features/verify/resolveVerdict.test.ts:8-12` and `accountStatusActions.test.ts:43-44` read sibling files. `apps/admin-web/src/lib/legacyWalletRemoval.test.ts:6` hardcodes its own path in `SELF`, so moving it makes the test scan itself.
  - #252: 18 single-line `toContain` assertions on `_shared/` import paths in 13 test files, the `bunfig.toml` preload `supabase/functions/_shared/__tests__/zod-runtime.bun.preload.ts`, `supabase/functions/__tests__/shipmentCancelSafetySourceGuards.test.ts:34,96,113`, and `supabase/migrations/__tests__/post-purchase-label-generation-remediation.test.ts:6,9`.
  - Every move: no check covers path citations in `docs/*.md`. `scripts/agent-instructions.ts` checks only the `AGENTS.md` files and our skills.
  - Rule for every move: when a test fails after a move, fix its path. Do not delete it, weaken it, or convert it in the move commit.

- L5 (proposal and classification, 2026-11-06).
  - Do not convert tests before the moves. The moves fail loudly, and the path fixes are mechanical.
  - Must-have: a guard that stops new source-text tests, counting per area so the moves never edit it, with a marker comment and reason for contracts. Extend the #250 path check to `docs/`. Convert money code first: the four Edge Functions in L3, then the money SQL to pgTAP.
  - Nice-to-have: one-line `index.ts` in every Edge Function; convert frontend and admin-web wiring when a file is touched; drop text assertions already covered by behavior in mixed files; sort `readdirSync` results before `files[0]` (about 40 sites, estimate).
  - Overengineering: a per-file inventory of all 257 files before starting (each item inventories its own area); a shared `readSource()` or `normalize()` helper, which would entrench the pattern; converting the 95 contract tests.

- L6 (maintainer, 2026-11-06, verbatim):

  > COnetstando: 1) SI HAGAMOS el roadmap aparte. 2) APRUEBO. 3)me parace bien. UNa cosa, de los nice to have, cuales si nlcuyes, que sinetas que es poco esfuerzo y mucha remuracion? y ULTMA RPEGUNTA, el hacre todo esto que haremos que cosas buenas trae al repo y al wokrflow mio y de los agentes?

  Decisions: a separate roadmap (S4 rewritten); the two new guards are approved (the source-text count guard and the `docs/` path check); the order is approved.

- L7 (answer to L6). Three nice-to-haves join the plan. Each area item drops the text assertions that behavior already covers in its mixed files. The money Edge Functions item makes their `index.ts` one line. Frontend and admin-web wiring is converted when a file is touched, written as a rule in `docs/conventions.md` and enforced by the guard. One-line `index.ts` in the other functions is roadmap item 6. Sorting `readdirSync` stays an Idea, because most of those sites are in `supabase/migrations/__tests__`, which item 5 removes.

- L8 (maintainer, 2026-11-06, verbatim):

  > okey master garcas por explicar, y si, si me parece bien todo, autorizo. Ultima prgeunta, esto que estamos aplciando es como el estandar de los dev pros? y un poroc vanuardista? o de donde nos estamos basando para hacr esta 'config' por asi decirlo

- L9 (plan change). The money SQL item was split in two (payouts and release; refunds, cancellation, settlement, and fee reconciliation), because about 45 migration tests do not fit one commit of about 400 lines (`docs/roadmaps.md`). The roadmap has six items.
