# Deploy staging from CI

Roadmap #299 item 15, issue #314. Branch `ci/staging-deploy` from `origin/main` 8fb64c65, worktree supabase-health.
Staging is the current project `acoiclkeymgtlwcxilun`. Production is a new project created at go-live (#313, PR #730). This feature deploys only staging; production's gated deploy is documented for go-live.

## Specs

- S1. Issue #314 scope: "A GitHub Actions job on merge to `main`, behind a protected environment with manual approval: `supabase link`, `supabase db push`, `supabase functions deploy`, with the pinned CLI." Done when: "A merge to `main` deploys exactly what the repository holds, and nothing is deployed by hand." For staging the maintainer chose "Solo, tras el CI verde (Recomendado)" (L5): the job starts when the `CI` workflow succeeds on a push to `main`, with no manual approval. The environment `staging` accepts deployments from `main` only. Manual approval applies to production, at go-live.
- S2. Every run deploys every function in `supabase/functions/` (maintainer: "Todas (Recomendado)", L3), so a `_shared` change reaches every function. It never passes `--prune` and never runs `supabase config push`.
- S3. Each run writes its migration dry run to the job summary before `supabase db push --remote --yes`. After the deploy, a check fails the run when the remote migration versions differ from the files in `supabase/migrations/`, or the deployed function slugs differ from the function directories (excluding `_shared` and `__tests__`). The comparison logic has unit tests.
- S4. The workflow also runs by hand (`workflow_dispatch`) for a chosen commit of `main`, which redeploys an earlier commit's functions (rollback). A bad migration is fixed with a new migration, never reverted by the workflow.
- S5. Credentials: a Supabase personal access token scoped to the staging project only, the staging database password, and the project ref, stored as secrets of the GitHub environment `staging`. Only the deploy job references that environment. One deploy runs at a time (`concurrency`). The CLI version matches the pin in `ci.yml`. Actions are pinned by SHA, `permissions` stay minimal, and checkout does not persist credentials.
- S6. Docs: the root `AGENTS.md` rule on deploys, `supabase/AGENTS.md` (who pushes migrations, drift check), `supabase/functions/AGENTS.md` ("Deploy and drift check"), `docs/go-live.md` ("Staging and production", section 1 step 5 on the Supabase GitHub integration, section 7, and the production environment with approval at go-live), and `docs/decision-log.md`. New rule: a pull request that adds a secret, Vault value, webhook, or Dashboard setting applies it on staging before the merge.
- S7. Maintainer steps: disconnect the Supabase GitHub integration (maintainer: "Desconectarla (Recomendado)", L3); create the scoped token, the environment `staging`, and its secrets. The first run brings all 44 deployed functions up to `main`.
- S8. Marking each deploy as a Sentry release is out of scope: an Idea issue records it.

## Tasks

- T1. S3: drift comparison script and its unit tests. Route: worker. Commit: pending.
- T2. S1, S2, S4, S5, S6: workflow `deploy-staging.yml` and the docs. Route: worker. Risk: items 2 and 5 (credentials, deploy). Own commit. Commit: pending.
- T3. S7: maintainer setup, first run, readback through the Supabase MCP. Route: inline, with the maintainer. Commit: none.
- T4. S8: Idea issue. Route: inline. Commit: none.

## Log

- L1. User request (2026-11-26): "okey master pregunta quieres seguir con lo ultimo del roadmaop aqui? siento que no ae muchod e conetxto en la window, no se que opines?creo que el siguiente issue no es tanto trabajo, que opinas?" Then: "a okey, si dale master, recuerda que tienes libertad absoluta para opinar de algo, incluso cambios de 360 si es que es necesario."
- L2. Evidence (2026-11-26): staging has 143 migrations, matching the repository up to `20261126005538`. It has 44 functions, matching the 44 directories. Many functions were deployed on 2026-11-12 and 2026-11-13 from the worktree `repo-hygiene` or from `/tmp` paths, before `_shared/sentry.ts` (2026-11-17) and `_shared/cancellation/shipment-cancellation.ts` (2026-11-15) changed, so staging does not run `main`'s code. The "Supabase Preview" check comes from the Supabase GitHub app ("This git branch is not associated with any Supabase Branch"), so the integration is still installed, although `docs/go-live.md` says it was disconnected on 2026-10-21. The repository has no Actions secrets. GitHub lists Vercel environments for four admin-web projects.
- L3. Maintainer decisions: integration "Desconectarla (Recomendado)"; trigger "Tras el CI verde de main + tu aprobación (Recomendado)"; functions "Todas (Recomendado)".
- L4. Research (2026-11-26): Supabase's "Managing Environments" guide uses two projects and GitHub Actions, "rather than deploying from your local machine", with `supabase link` and `supabase db push --yes --remote`, a scoped personal access token, and no approval step. Trunk-based teams promote the same commit from staging to production, with approval on production through GitHub environments.
- L5. Maintainer: staging "Solo, tras el CI verde (Recomendado)" (replaces the approval choice in L3); plan "Sí, empezá".
