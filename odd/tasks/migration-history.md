# Migration history matches the repository

Roadmap #299, item 2 (#301). Branch `chore/migration-history`, worktree `supabase-health`.
The remote migration history lists 4 of 78 migrations; the rest were applied by hand.

## Specs

- S1. "Compará el esquema real del remoto (por el MCP, solo lectura) contra una base local con supabase db reset, y listame cada diferencia clasificada: migración del repo que nunca se aplicó, cambio hecho a mano que no está en el repo, o diferencia real a corregir."
- S2. "Las diferencias reales se arreglan con migraciones, test primero."
- S3. "Yo corro supabase migration repair --status applied y cualquier comando que necesite mi login; pasame los comandos exactos."
- S4. "Documentá el chequeo de drift en supabase/AGENTS.md."
- S5. "Cuando esté todo, hacé push, PR con Closes #301 y merge."
- S6. From #301, "Done when": "`supabase migration list` shows local and remote in sync, and the schema comparison is empty."

## Tasks

| ID  | Specs  | Task                                                                                      | Route  | Commit |
| --- | ------ | ----------------------------------------------------------------------------------------- | ------ | ------ |
| T1  | S1     | Compare remote and local catalogs and classify every difference                           | inline | (none) |
| T2  | S2     | Migration: align local privileges with the remote (default ACL, 3 functions, 4 tables)    | worker |        |
| T3  | S2     | Migration: remove the unused `public-assets` bucket                                       | worker |        |
| T4  | S1, S4 | Commit the catalog fingerprint query and document the drift check in `supabase/AGENTS.md` | inline |        |
| T5  | S3     | Hand the maintainer the exact link, repair and push commands                              | inline | (none) |
| T6  | S6     | Re-run the comparison and migration history check after the maintainer's commands         | inline | (none) |
| T7  | S5     | Push, PR with `Closes #301`, merge                                                        | inline |        |

## Log

- L1 (user, 2026-11-09): "Seguimos con el roadmap #299 (Supabase health), ítem 2: #301, "Make the remote migration history match the repository". Worktree C:/dev/School-portal-worktrees/supabase-health; creá una rama nueva desde main actualizado (por ejemplo chore/migration-history). Antes de nada: - Leé #299 y #301, y en Engram el resumen de la sesión anterior y los topics "roadmap/supabase-health" y "odd/supabase-audit-security/tasks". - El ítem 1 (#300) y sus follow-ups ya están mergeados y desplegados (PRs #334 y #343). Lo que quiero: - Compará el esquema real del remoto (por el MCP, solo lectura) contra una base local con supabase db reset, y listame cada diferencia clasificada: migración del repo que nunca se aplicó, cambio hecho a mano que no está en el repo, o diferencia real a corregir. - Las diferencias reales se arreglan con migraciones, test primero. - Yo corro supabase migration repair --status applied y cualquier comando que necesite mi login; pasame los comandos exactos. - Documentá el chequeo de drift en supabase/AGENTS.md. - Cuando esté todo, hacé push, PR con Closes #301 y merge. Docker ya está prendido."
- L2 (T1 evidence, 2026-11-09, main at 2abea6f2): catalog fingerprint (schemas, relations, owners, columns, constraints, indexes, triggers, policies, functions with ACLs, types, extensions, publications, buckets, default ACLs) compared between the remote (MCP) and a fresh local `supabase db reset`. Equal: constraints, indexes, policies, types, owners, schemas, extensions, every function body, `push_event_policy` rows (the only seed-like rows a migration inserts). Different:
  - Never applied: none. Every migration's objects exist on the remote; only the history rows are missing (74 of 78).
  - Hand changes on the remote, kept from archived pre-baseline migrations that the baseline dump cannot reproduce (same cause as #88): default privileges for functions created by `postgres` in `public` grant EXECUTE only to `postgres` and `service_role` (local adds `anon`, `authenticated`); `fn_shipments_status_trigger()` and `prevent_shipment_origin_snapshot_mutation()` have no `anon`/`authenticated` EXECUTE and `is_admin()` has no `anon` EXECUTE; `service_role` has no privilege on `connect_account_actionability`, `connect_account_events`, `connect_payout_events`, `shipment_cancellation_operations` (local: `arwdm`). No Edge Function reads those tables directly. Bucket `public-assets` deleted in the Dashboard (#300); migration `20261020100001` still creates it.
  - Platform, not drift: `pg_net` and `wrappers` versions; `realtime.messages` publication; storage lifecycle triggers on `storage.buckets`; column defaults shown as `extensions.uuid_generate_v4()` (session `search_path`).
