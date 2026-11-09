# Supabase audit security fixes

Item 1 of roadmap #299 (issue #300): fixes for the findings of the 2026-11-08 Supabase audit that the maintainer tracks in private security advisories. Branch `fix/supabase-audit-security`, worktree `supabase-health`. Details of the findings are kept outside the repository until each fix is deployed (`SECURITY.md`).

## Specs

- **S1** "Un commit por advisory, test primero (pgTAP por rol o Bruno) contra el stack local (supabase start, supabase db reset)."
- **S2** "Son vulnerabilidades sin arreglar: no describas los detalles en commits, PRs, issues ni archivos del repo hasta que estén desplegadas. Usá mensajes genéricos."
- **S3** "Yo aplico el SQL y despliego a mano. Cuando lo confirme, cerrás los advisories."
- **S4** "Arrancá con GHSA-4983: es el más grave."
- **S5** Advisories in scope: GHSA-4983-wpx7-6c2x, GHSA-33mw-fxr7-2rvx and GHSA-h9px-rmh3-jfx9. "GHSA-w856 no entra: es del rediseño de disputas (#261)."

## Tasks

| ID  | Specs      | Route  | Commit   |
| --- | ---------- | ------ | -------- |
| T1  | S1, S2, S4 | inline | f22e38fc |
| T2  | S1, S2     | worker | 05673b95 |
| T3  | S1, S2     | worker | next     |
| T4  | S3         | inline | pending  |

- T1: fix for GHSA-4983-wpx7-6c2x.
- T2: fix for GHSA-33mw-fxr7-2rvx.
- T3: fix for GHSA-h9px-rmh3-jfx9.
- T4: after the maintainer confirms each deploy, regenerate types if the schema changed and close the advisory.

## Log

- **L1** (2026-11-08, maintainer): "Trabajamos en el ítem 1 del roadmap #299 (Supabase health): issue #300, "Security fixes from the audit". Worktree: C:/dev/School-portal-worktrees/supabase-health, rama fix/supabase-audit-security. Antes de nada: - Leé #299 y #300, y en Engram los topics "roadmap/supabase-health" y "supabase/audit-2026-11". - Leé los 3 advisories privados que cubre este ítem: GHSA-4983-wpx7-6c2x, GHSA-33mw-fxr7-2rvx y GHSA-h9px-rmh3-jfx9 (gh api repos/ydafy/Selene-project/security-advisories/<id>). GHSA-w856 no entra: es del rediseño de disputas (#261). Reglas: - Son vulnerabilidades sin arreglar: no describas los detalles en commits, PRs, issues ni archivos del repo hasta que estén desplegadas. Usá mensajes genéricos. - Un commit por advisory, test primero (pgTAP por rol o Bruno) contra el stack local (supabase start, supabase db reset). - Yo aplico el SQL y despliego a mano. Cuando lo confirme, cerrás los advisories. Arrancá con GHSA-4983: es el más grave."
- **L2** T1 committed in 2c76e9c9: one migration plus a pgTAP file, red before the migration and green after it on `supabase db reset`; local REST calls as anon and as the seed buyer return 401/403 for the writes and 200 for the read. Native review (risk, reliability) approved with non-blocking notes. Awaiting the maintainer's deploy.
- **L3** Independent verification of T1: met for S1, S2 and S4, no blockers. Follow-up in the next commit: a corrected migration comment and two catalog assertions in the pgTAP file (each shown to fail against a rolled-back regression). The snapshots in `supabase/queries/rls/` are regenerated in T4, after the deploy.
- **L4** (2026-11-08, maintainer): chose "Cerrarlo ahora dentro de GHSA-4983" for a related gap the verifier found. Same migration file (not deployed yet), red then green in the pgTAP file.
- **L5** Independent verification of f444a84a: met, no blockers. Follow-ups: one more pgTAP case (next commit); after the deploy, update the review comments in `apps/frontend/src/features/orders/logic/use-review-action.helpers.ts` and `review-modal.tsx` together with the `supabase/queries/rls/` snapshots (T4). Outside this work: #319.
- **L6** (2026-11-08, maintainer): "Ya aploque la migracion, sobre el punto 4, si, tienes mi luz verde". Remote read after the deploy: the policies, client privileges and the review constraint match the local stack; the security and performance advisors show nothing new from this change. T1 squashed into one commit. The `supabase/queries/rls/` JSON snapshots were already stale before this work (they still list policies dropped on 2026-10-28) and #303 replaces `supabase/queries/`, so they stay as they are. The review comments in the app now match the insert policy.
- **L7** (2026-11-08, maintainer): chose the four recommended options for the T2 design questions. The questions and answers stay in Engram (`odd/supabase-audit-security/t2-decisions`) until T2 is deployed, then move here. A related cleanup stays in #29.
- **L8** T2 implemented by two parallel workers (storage SQL; app, admin-web and Edge Function changes) plus an integration worker. Each new pgTAP file fails against the previous SQL (rolled back) and passes after it; `bun run test:db` passes (15 files, 483 tests) and the `bruno/dispute-integrity` folder passes on the local stack. Outside this work: #322, #323. Deleting one storage bucket is a manual Dashboard step (`docs/go-live.md`).
- **L9** T2 independent verification: met for S1 and S2, no blockers. Native review (risk, resilience, reliability) approved with non-blocking notes. Follow-up commit: more malformed-path cases in `evidence_paths.test.sql` and a comment on a misnamed dropped policy (checked on the remote: it applies to the evidence bucket only). Awaiting the maintainer's deploy.
- **L10** T2 decisions (2026-11-08, maintainer, moved here after the deploy from Engram `odd/supabase-audit-security/t2-decisions`): the evidence bucket is private and the database stores object paths, not URLs; product uploads go only into the seller's own folder; the nightly evidence purge stays in #29; the unused `public-assets` bucket is deleted and `Avatars` keeps public reads with a 2 MiB image-only limit.
- **L11** (2026-11-08, maintainer): "master ya hice el deploy de las edge fuctions en este woktree". Remote read: both migrations applied, buckets and storage policies match the migration, `create-dispute` (v39) and `generate-shipping-label` (v65) deployed from this worktree; the security advisor shows nothing new. GHSA-33mw closed. Still manual: delete `public-assets` (its logo file is tracked in #326), deploy admin-web, reload the app bundle.
- **L12** (2026-11-08, maintainer): chose "Borrar las dos" for T3. Remote read: no pg_cron job calls the `track-returns` or `return-delivery-timeout` Edge Functions (the `return-delivery-timeout` job runs the SQL function directly) and no client calls them. Both functions are removed with their source-text assertions and docs; the maintainer deletes the deployed copies with `supabase functions delete`.
