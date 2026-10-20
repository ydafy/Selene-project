# Supabase development workflow

Give agents direct, safe visibility into the remote Supabase project and a reproducible local Supabase stack, so the repository becomes the source of truth and production can be built from it.
Remote project `acoiclkeymgtlwcxilun` holds only fake data but is treated as production: agents never mutate it.

## Specs

- S1: "quiero conectar el MCP oficial de Supabase a este agente (gentle-shell/Pi) para que pueda leer mi proyecto" — the official Supabase MCP is configured for remote project `acoiclkeymgtlwcxilun`, project-scoped and read-only, authenticated without a token stored in any file.
- S2: "para que no me tentgas que estar diceidno 'Oye pon este preflifght y dime que sale' o 'Oye no puedo ver permisos, pon este sql en tu dashboard de SB y dime que sale'" — agents can run read-only SQL, read logs, advisors, migrations and deployed Edge Functions directly.
- S3: "de una vez hagamos las dos configuarciones osea doker+supabase y lo del mcp" — a local Supabase stack (Docker) is available for tests that mutate data.
- S4: "mi filosofia es siempre tatrar de hacer las cosas como deven estar en rpdocuion ... nda de cosas simuladas" — no sandbox shortcuts; the remote project is never mutated by agents.
- S5: "al terminar yua todo el proyecto y este apunto de soltar la app, abro una copia del actual pero sin datos" — production must be reproducible from the repository (migrations, config, go-live runbook).
- S6: "sobre todo una mejor manera para detectar errores" — drift, advisors and database tests surface errors before delivery.

## Tasks

- [x] T1 (S1, S2, S4; inline; user-level config, no repo commit): read-only, project-scoped Supabase MCP in `~/.gentle-shell/agent/mcp.json` with OAuth; verified.
- [x] T2 (S2, S6; inline; report only): drift diagnosis (L7). Commit 184f184 (this document).
- [x] T3 (S5): schema baseline. Commits 153af64 (archive), 0737792 (baseline + storage + privilege alignment + test), a2110bc (docs). Remote history repair pending maintainer.
- [x] T4 (S3): local stack + seed. Commits b85e114 (types barrel `.ts` fix for CLI 2.121), 0b38b4e (auth.users triggers), 892ed86 (seed). Verified: reset loads 3 accounts that log in via Auth API, 4 VERIFIED listings visible to anon, wrong password rejected. Remote repair of 20261020100003 pending maintainer.
- [ ] T5 (S3, S4): move `shipment-cancellations` harness to local stack. Blocked on T4 and that branch merging.
- [ ] T6 (S6): pgTAP money/authorization invariants. Blocked on T4.
- [x] T7 (S5): `docs/go-live.md` runbook + deployed `verify_jwt` flags in `supabase/config.toml`. Commit 7d255a5.
- [x] T8 (S6): minimal CI, `bun test` only (lint and tsc baselines red). Commit ed8b44f. Not yet observed on GitHub.
- [x] T9 (S2): `AGENTS.md` remote inspection rule. Commit 8119d69.
- [x] T10 (S6): revoke API execute on `fn_reconcile_connect_payments` and anon execute on `fn_lock_product`. Commit 7f14730. Applied and verified by MCP.
- [x] T11: AGENTS.md rewrite (a660c74, 738fa9e).
- [x] A1: ESLint ignores nested `dist`/`build`/`.expo`; lint 1582 -> 95 errors. Commit 8f2db18.
- [x] A2: `bun run typecheck` across workspaces. Commit 9a286d5.
- [x] A3: `apps/admin-web/.env.example`, created by the maintainer (gentle safety policy blocks agent writes to `.env*`).
- [x] A4: removed stale `sql.sql` scratch log. Commit f0cfd59. The T3 baseline dumps from the remote, so the old copy added no value and risked misleading agents.
- [x] A5: pruned 2 stale worktree entries (no commit).
- [x] A6: PR #8 merged (d300a2e); branch protection dropped (solo dev, free plan).
- [x] A7 (L23, L24): untrack leaked Android keystore + `credentials.json`, ignore them. Commit 95e1deb. Maintainer rotates to an EAS-managed keystore and updates the Google Sign-In SHA-1 (`docs/go-live.md` section 11).
- [x] A8 (L23): remove stale root `app.json`/`eas.json` and dead `apps/frontend/expo.config.js`. Verified: `expo config --type public` in `apps/frontend` byte-identical before and after.
- [x] A9 (L23, L25): pin Bun 1.4.2 (`packageManager`, CI reads it, all EAS profiles) and declare the Edge Runtime Deno major in `supabase/config.toml`; decision recorded in `docs/decision-log.md`. Verified: `bun install --frozen-lockfile` no changes; local stack + `functions serve` boots the runtime, unsigned `stripe-webhooks` -> 400. Pending maintainer: one development EAS build on Bun 1.4.2.
- [ ] A10 (L23): Dependabot recommendation (alerts + security updates only).

## Log

- L1: "Che, quiero conectar el MCP oficial de Supabase a este agente (gentle-shell/Pi) para que pueda leer mi proyecto de SANDBOX. Guiame paso a paso y hacé vos todo lo que puedas y recomeindame lo que quieras, la idea es que los agentes y tu esten mas ocnectados con mi supabse, ay que actualmente la carpeta supabase que esta en el repo es meramente una copia de lo que esta en mi supabase solamente para que tu puedas ver todo de manera mas facil, lo que quiero es que puedas hacer consultas o no se coas asi para que no me tentgas que estar diceidno 'Oye pon este preflifght y dime que sale' o 'Oye no puedo ver permisos, pon este sql en tu dashboard de SB y dime que sale' etc etc, osea quiero agilizar o optimiazr nuestro workflow. Segun yo ocpabamos hacre algo con doker + supabase pero por lo que vi es via mcp. NO hagas anda solo aclarame esto."
- L2: "okey de una vez hagamos las dos configuarciones osea doker+supabase y lo del mcp. EL punto de todo esto es un mejor workflow entre tu yo y el repo ... Dejemos de lado sentry y postamn que eso lo tocaremos depues."
- L3: Project `acoiclkeymgtlwcxilun` is the only project; data is fake but it is treated as production. "a mi me gusta trabajar en un modulo como si fuera a salir manana a prodcuion, nda de cosas simuladas o cosas asi."
- L4: User approved the plan and order: "arranca".
- L5: T1 evidence — added `supabase` entry to `~/.gentle-shell/agent/mcp.json` (backup `mcp.json.bak-before-supabase`): URL `https://mcp.supabase.com/mcp?project_ref=acoiclkeymgtlwcxilun&read_only=true&features=database,debugging,development,functions,docs`, `exposure: hidden` with read-only tool allowlist set to `direct`. JSON validated; gentle-shell `mcp list` reports `supabase: needs sign-in`. Blocked on user OAuth sign-in.
- L6: User signed in ("listo."). T1 verified: `list_tables` returned 37 public tables; `execute_sql` runs as `supabase_read_only_user` with `default_transaction_read_only = on`; 55 policies across 28 tables. T1 done.
- L7: T2 drift findings (read-only, 2026-10-18):
  1. Remote `list_migrations` is empty: no SQL was ever recorded in remote migration history; the remote state is not traceable to repo migrations.
  2. Repo migrations start at `20260528000000_drop_legacy_columns`; there is no base schema migration, so `supabase db reset` cannot rebuild the database from the repo.
  3. Duplicate migration version `20260923000000` (`idempotent_connect_payout_terminal_projection` and `notification_client_authority`); the CLI keys history by version.
  4. Remote table `shipment_cancellation_operations` has no migration on `main` (it lives on unmerged `feat/shipment-cancellations`).
  5. Edge Functions deployed from unmerged worktrees: `cancel-order`, `auto-cancel-orders`, `auto-cancel-preparing`, `release-connect-payout` (shipment-cancellations), `generate-shipping-label` (mobile-ui-polish), `get-connect-payout-release-queue` (admin-payments-redesign). Orphan deployed function `dynamic-api` (name `get-shipping-quote-seller`) has no repo source.
  6. Security advisors: `SECURITY DEFINER` executable by `anon`: `fn_lock_product`, `fn_reconcile_connect_payments`, `is_admin`; by `authenticated`: 13 incl. legacy `fn_request_payout`, `fn_save_bank_account`, and admin RPCs taking client `p_admin_id`. `pg_net` in `public`. Leaked password protection disabled. 10 tables RLS-on/no-policy (likely intentional server-only; to confirm).
     T2 done; T3 needs maintainer decision on baseline strategy.
- L8: User: findings 4-5 come from worktree deploys; baseline waits until worktrees merge. "has todo lo que se deba hacer intependientemente de los woktree". User asked to commit first ("master commtea primero").
- L9: Evidence. `is_admin()` must keep PUBLIC execute: 16 PUBLIC-role RLS policies call it. `fn_reconcile_connect_payments` cron job runs as `postgres`. Lint baseline: 1486 errors from ignored `apps/admin-web/dist` build output + ~95 in source; hooks ran 1812 tests, 0 fail.
- L10: Open findings needing decisions (not fixed): `fn_release_products` lets any signed-in user release any reserved product (checkout; own feature); `track-shipments` on `main` has `verify_jwt = false` and no caller check (tracking worktrees rewrite it); cron jobs `auto-cancel-orders-job` and `track-shipments-every-6-hours` embed literal JWTs; `evidence` bucket is public; legacy `fn_request_payout`/`fn_save_bank_account` still granted and referenced by `useWalletStore`; leaked password protection off; `pg_net` in `public`; orphan function `dynamic-api`.
- L11: Block B (security items above) deferred by maintainer; investigate worktrees first when reached. Order: A setup -> B security -> C lint/tsc baselines + strict CI -> D baseline/local stack -> Sentry, Bruno/.http, Dependabot.
- L13: Maintainer: "sql.sql deveria irse, ese archivo era como un log pero es de hace mucho tiempo, quitalo." Keep recording incidental findings (counts, likely causes) in this Log for later blocks.
- L14: For block C: root `tests/` holds two loose files (`shipment-cancel-safety.test.ts`, `test-only-guard.test.ts`) while other tests sit next to their code; decide placement. Playwright `e2e/` (admin-web, mocked Supabase) stays at root and is not in CI yet; decide whether CI runs it.
- L15: Regenerated `database.types.ts` (138 lines, all shipment-cancellations objects) left out of PR #8; it belongs to `feat/shipment-cancellations`.
- L16: First CI run failed (4 test files): `_shared/zod-runtime.ts` imports Deno `npm:zod@4.1.12`; the Bun mock `zod-runtime.bun.preload.ts` was imported by only one test, so other files passed locally only by load order. Fixed by `[test] preload` in `bunfig.toml` (bce8ab8). CI green: 1812 tests, 0 fail.
- L17: Worktree tracking-foundation-pr2 held finished, deployed tracking work never committed (lost in the 2026-08-30 consolidation). Rescued into main: c27676b, d2bc103, cd3cfe1. Worktree and branch removed.
- L18: First schema dump exposed a service_role JWT in trigger `tr_webhook_order_completed` (dead target `order-automation`) and a Stripe sk_test key in FDW `stripe_server`. Dropped by 35116e7 (applied by maintainer, verified). Key rotation deferred to go-live (new project with sb_ keys).
- L19: Baseline verification after `supabase db reset`: hashes equal to remote for functions (code; 4 differ only by CLI-stripped column-0 comments and CRLF), policies (68), triggers, columns (8 differ only by `extensions.` display qualification), indexes (136), constraints (160), enums (50), views (8), table and column grants. Local default privileges added REFERENCES/TRIGGER/TRUNCATE on server-only tables; fixed by 20261020100002 (no-op on remote).
- L20: For block B, storage policies mirrored as-is: any authenticated user can read every `verification` file ("Allow Select Own Files"), `evidence` bucket public, evidence delete matches `name LIKE %uid%`.
- L21: Supabase CLI 2.121 turned a long-standing WARN into a fatal error: the CLI walks Edge Function imports by regex and followed `packages/types/src/index.ts` -> `./database.types` (no extension). Fixed with `.ts` specifiers and `export type *`; typecheck counts unchanged. The dump also omitted the 3 custom triggers on auth.users (one duplicate update trigger mirrored as-is). Remote oddities to review: `system_settings.connect_enabled = false` (legacy wallet RPCs not gated) and `checkout_recovery_running = true` stuck.
- L12: Typecheck baseline: frontend 56 errors, backend 145 (mostly duplicate `@types/node` 24 and 26 conflict), types 1, admin-web 0.
- L23: "Ahora quiero seguir con la limpieza del repo que habíamos elegido: 1. el app.json y eas.json duplicados (raíz vs apps/frontend), 2. fijar las versiones de Bun y Deno en el repo, 3. ver si conviene Dependabot solo para alertas de seguridad. Después de eso arrancamos con fn_release_products (bloque B). Commits acotados, como siempre."
- L24: Found while auditing A8: public repo `ydafy/Selene-project` tracks `apps/frontend/credentials/android/keystore.jks` and `apps/frontend/credentials.json` (alias and both passwords) since 2a4f97b (2025-11-15). Maintainer confirmed no build was ever uploaded to Google Play, so the key is discarded, not reset. Root `app.json` holds a second EAS projectId `f5f38257-...` and package `com.alvaroest19.selenemonorepo` from the 2026-08-30 consolidation; `expo config` in `apps/frontend` resolves `48bbf920-...` / `com.selene.marketplace` without it. GitHub: secret scanning + push protection on, no open alerts; Dependabot alerts and security updates off. Supabase CLI serves functions with its own Edge Runtime, not the local Deno CLI (2.6.6). Stray root `deno.lock` noted for block C.
- L25: Maintainer chose Bun 1.4.2 everywhere over returning to the 2026-01-27 pin of 1.3.11 (local, CI and `bun.lock` were already on 1.4.2; only EAS was on 1.3.11). Edge Runtime reports Deno v2.1.4 compatibility; local Deno CLI is 2.6.6.
- L26: For A10 and a later dependency task: Dependabot security updates do not support Bun (version updates only), and the repo dependency-graph SBOM endpoint returns 404, so Dependabot alerts would cover `deno.lock` and Actions but not `bun.lock`. `bun audit` on main: 37 vulnerabilities (2 critical: `proxy-addr` 2.0.7 via Express, `shell-quote` 1.10.0 via RN tooling; 15 high, mostly build tooling: brace-expansion, braces, postcss, source-map-js, image-size, node-forge, undici 8.9.0, vite 8.3.0). Not fixed here.
- L22: Maintainer works in parallel worktrees; default local stacks collided on fixed ports. Enabled CLI 2.121 experimental stack mode (`[experimental] stack = true`): per-worktree/branch local projects with auto ports. Verified two stacks side by side (API 22319 and 20397), migrations + seed applied on first start. `stripe:listen` now `scripts/stripe-listen.ts` (reads `supabase status --env` JSON, refuses non-local URLs); e2e on stack: real event 200, forged 400. Fallback: `SUPABASE_EXPERIMENTAL_STACK=0`. Old default-mode containers are stopped, not deleted.
