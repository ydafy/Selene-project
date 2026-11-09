# Audit follow-ups

Three short findings opened during the Supabase audit security fixes (#300), fixed together in this worktree. Branch `fix/audit-followups`, worktree `supabase-health`. Related to roadmap #299, not part of it.

## Specs

- **S1** #319: "Map known errors to i18n strings in English and Spanish (`apps/frontend/AGENTS.md`, "Strings"): a duplicate review (`23505`) gets an "already reviewed" message, and anything else gets `common:errors.generic`. Keep the raw error in the logs only."
- **S2** #322: "One shape for `shipments.shipping_evidence`, written by the Edge Function and read by admin-web, with a test on each side that pins it."
- **S3** #323: "Either the upload uses a fresh path each time and `upsert: false`, or the bucket gets an owner-scoped UPDATE policy. Reproduce on the local stack first."
- **S4** "un commit por issue y test primero" (the plan the maintainer accepted for this batch).

## Tasks

| ID  | Specs  | Route  | Commit  |
| --- | ------ | ------ | ------- |
| T1  | S1, S4 | worker | pending |
| T2  | S2, S4 | worker | pending |
| T3  | S3, S4 | worker | pending |

## Log

- **L1** (2026-11-09, maintainer): "Sobre los issues que abriste en camino, dime cuales podemos incluir en neustro roadmap para solucionalos de una vez en este woktre, y es mas, me gustaria que agregaras todos, pero, si un issue se ve que encesita un poco mas de trabajo osea que no es una arreglo corto pues ese si lo dejamos fuera del roadmap pero en este woktree lo resolveremos. que opinas y que atacariamos?"
- **L2** (2026-11-09, maintainer): "me gusta tu plan" — the plan: #319, #322 and #323 on `fix/audit-followups`, one commit per issue, test first, one PR closing the three, linked to #299 as related; #326 waits for a logo decision, #66 stays with #261, #309 is roadmap item 10.
