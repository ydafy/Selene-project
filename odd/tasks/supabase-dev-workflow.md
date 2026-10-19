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

- T1 (S1, S2, S4; inline; no repo commit — user-level config): Configure read-only, project-scoped Supabase MCP in `~/.gentle-shell/agent/mcp.json` with OAuth; user signs in; verify with `list_tables` and a `pg_policies` query.
- T2 (S2, S6; inline; report only): Drift diagnosis — compare remote schema/migration history against `supabase/migrations/`; report before deciding.
- T3 (S5; inline): Baseline migration that closes drift (decision after T2).
- T4 (S3; inline): Local stack via `supabase start` + `supabase/seed.sql`; `db reset` replays all migrations.
- T5 (S3, S4): Move the `shipment-cancellations` bare-Postgres harness onto the local Supabase stack (decision required; that worktree has its own branch).
- T6 (S6): pgTAP tests for money and authorization invariants via `supabase test db`.
- T7 (S5): `docs/go-live.md` runbook and config-as-code in `supabase/config.toml`.
- T8 (S6): Minimal CI (lint, typecheck, `bun test`).
- T9 (S2): Update `AGENTS.md` so agents use the MCP for remote state instead of asking the maintainer.

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
