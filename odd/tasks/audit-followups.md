# Audit follow-ups

Three short findings opened during the Supabase audit security fixes (#300), fixed together in this worktree. Branch `fix/audit-followups`, worktree `supabase-health`. Related to roadmap #299, not part of it.

## Specs

- **S1** #319: "Map known errors to i18n strings in English and Spanish (`apps/frontend/AGENTS.md`, "Strings"): a duplicate review (`23505`) gets an "already reviewed" message, and anything else gets `common:errors.generic`. Keep the raw error in the logs only."
- **S2** #322: "One shape for `shipments.shipping_evidence`, written by the Edge Function and read by admin-web, with a test on each side that pins it."
- **S3** #323: "Either the upload uses a fresh path each time and `upsert: false`, or the bucket gets an owner-scoped UPDATE policy. Reproduce on the local stack first."
- **S4** "un commit por issue y test primero" (the plan the maintainer accepted for this batch).

## Tasks

| ID  | Specs  | Route  | Commit   |
| --- | ------ | ------ | -------- |
| T1  | S1, S4 | worker | a43622ec |
| T2  | S2, S4 | worker | 43b09bea |
| T3  | S3, S4 | inline | c326e9a2 |

## Log

- **L1** (2026-11-09, maintainer): "Sobre los issues que abriste en camino, dime cuales podemos incluir en neustro roadmap para solucionalos de una vez en este woktre, y es mas, me gustaria que agregaras todos, pero, si un issue se ve que encesita un poco mas de trabajo osea que no es una arreglo corto pues ese si lo dejamos fuera del roadmap pero en este woktree lo resolveremos. que opinas y que atacariamos?"
- **L2** (2026-11-09, maintainer): "me gusta tu plan" — the plan: #319, #322 and #323 on `fix/audit-followups`, one commit per issue, test first, one PR closing the three, linked to #299 as related; #326 waits for a logo decision, #66 stays with #261, #309 is roadmap item 10.
- **L3** T3: reproduced on the local stack. A second upload to the same `verification` path with upsert is rejected (403, no UPDATE policy), but the app builds a new path per upload, so users never hit it. Applied the issue's preferred option anyway: fresh path and `upsert: false`, pinned by a test.
- **L4** T2 Playwright proof: `e2e/admin-web-local/dispute-packing-photos.local.e2e.ts` passes on the local stack (three packing photos rendered through signed `evidence` URLs). It seeds the stored shape directly, so the write side is proven by the Edge Function test, not by this spec.
- **L5** (2026-11-09, maintainer): "no 319, lo metemos de una" — #319 stays in this batch; the reviews module gets its own audit (#339).
