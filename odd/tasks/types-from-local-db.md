# Database types from the local database, checked in CI

Roadmap #299, item 5 (#304). Branch `chore/types-from-local-db` from `origin/main` 6f5eea3f, worktree `supabase-health`.
One PR (Closes #304), two commits. Nothing changes on the remote project.

## Specs

- S1. "Investigá primero y proponeme el plan antes de escribir."
- S2. "Test primero donde aplique, y documentá lo que cambie."
- S3. "Si hay que tocar el remoto, pasame los comandos."
- S4. "Cuando esté todo, hacé push, PR con Closes #304 y merge."
- S5. From #304, scope: "`db:types` runs `supabase gen types typescript --local` after `supabase db reset`." "A CI job regenerates the file and fails if it differs from the committed one." "Update the `db:types` line in `AGENTS.md` ("Commands") and `supabase/AGENTS.md`. The generated file still goes in the same commit as its migration." Done when: "CI fails on a migration committed without its regenerated types."
- S6. Approved plan (L2): a script with a write mode (`bun run db:types`) and a check mode (`bun run db:types:check`) that runs `supabase gen types typescript --local --schema public`, formats the output with the repository's Prettier, and writes only when generation succeeded; `database.types.ts` leaves `.prettierignore`; the `db-test` CI job installs dependencies and runs the check; docs updated.
- S7. Decision (L3): `db:types` does not run `supabase db reset` itself; the docs place it after the reset, and CI catches a stale local database.

## Tasks

- T1 (S2, S5, S6): script with write mode and tests, `db:types` switched to it, `.prettierignore`, `database.types.ts` regenerated from the local database, view nullability reviewed, admin-web test fixtures adjusted. Inline. Commits: `f3d408f2` (webhook DLQ fix the new types caught, own commit), `1f4e2a10` (about 230 authored lines plus the generated file).
- T2 (S2, S5, S6, S7): check mode and tests, `db-test` CI step, docs (`supabase/AGENTS.md`, `docs/go-live.md`, `docs/decision-log.md`), proof that a migration without regenerated types fails the check. Inline. Commit: the `ci(types)` commit after `1f4e2a10`.
- T3 (S3, S4): push, PR with `Closes #304`, CI green, merge; Engram memory `supabase/migration-apply-flow` and roadmap topic updated. Commit: none.

## Log

- L1. User request (2026-11-10): "Seguimos con el roadmap #299 (Supabase health), ítem 5: #304, tipos generados desde la base local con chequeo en CI. Usá el worktree C:/dev/School-portal-worktrees/supabase-health y creá una rama nueva desde main actualizado. Antes de nada, leé #299 y #304, y en Engram el último resumen de sesión y el topic roadmap/supabase-health. Los ítems 1 a 4 ya están mergeados: supabase/schemas/ es la fuente de verdad, db:schema:check corre en CI y los cron jobs son código (#302). Investigá primero y proponeme el plan antes de escribir. Test primero donde aplique, y documentá lo que cambie. Si hay que tocar el remoto, pasame los comandos. Cuando esté todo, hacé push, PR con Closes #304 y merge."
- L2. Investigation: CLI 2.122.0 `gen types --local` prints "Generated TypeScript is unformatted" and emits compact output; after Prettier, it differs from the remote-generated file in 215 lines because the local generator is postgres-meta v0.100.0 (pinned in `supabase/supabase.lock`): generated columns are `never` on Insert/Update, NOT NULL JSON is `NonNullable<Json>`, view columns get inferred nullability, argument-less functions get `Args: Record<PropertyKey, never>`, and `__InternalSupabase.PostgrestVersion` is gone. Typecheck with those types: frontend 0 errors, admin-web 4 errors in two tests whose fixtures pass `null` for view columns. Maintainer approved the plan as proposed, including the `ci.yml` and `.prettierignore` changes.
- L3. Maintainer asked for an explicit recommendation on resetting inside `db:types`: "necesito aqui tu reconednacion mas explicita y que recapacites que es lomejor y lo mejor para el repo quecreas". Recommendation taken: no reset inside the script (CI starts from an empty database and catches stale types; a reset would make a read-only command destroy local data and cost about a minute).
- L4. T1 evidence: branch fast-forwarded to `origin/main` 6de1dc4b (#407, #408) before committing; types regenerated after `supabase db reset`. View nullability reviewed: columns from `LEFT JOIN`s stay nullable, base-table columns are non-null, which matches the SQL. The two admin-web fixtures built rows the views cannot return; they keep testing the mapper guards through an explicit cast. `deno check --frozen */index.ts` found one error: `stripe-webhooks/index.ts` inserted a `Json` that could be `null` into `webhook_dlq.payload` (NOT NULL); a body of `null` lost the dead-letter row. Fixed in `f3d408f2` (covered by `deno check`; the handler has no unit seam for this path). Checks: typecheck (3 workspaces and root), lint 0 errors, format, knip, `deno check`, `bun test` 4817/4817.
- L5. T2 evidence: RED observed (3 of 5 check-mode tests failed before the implementation), then 8/8. Proof of #304 "Done when": a temporary migration adding `public.webhook_dlq.types_check_probe`, applied with `supabase migration up --local`, made `bun run db:types:check` exit 1 ("first difference at line 2896"); after removing it and `supabase db reset`, exit 0. Nothing changes on the remote project.
