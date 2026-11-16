# Operations: storage cleanup, cron HTTP monitoring, pg_net, bucket limits

Roadmap #299 item 13, issue #312 (closes #29). Branch `feat/ops-cron-storage` from `origin/main` c746e746, worktree supabase-health.
Three PRs (L7): A1 (C1, C2, C3a), A2 (C3b, C4: cron HTTP failures reach Sentry), B (C5, C6: purge).

## Specs

- S1. "Size and MIME limits on every bucket; document each bucket and its expected paths in `docs/go-live.md` section 4." `verification` (the only bucket without limits) gets limits that match what the app uploads: camera photos through `buildVerificationProofUpload` (`<product_id>/<prefix>_<timestamp>.<ext>`), so private, 10 MiB, JPEG, PNG, WebP, HEIC, HEIF. pgTAP `storage_access.test.sql` pins every bucket.
- S2. "Move `pg_net` to the `extensions` schema." The advisor `extension_in_public` no longer reports it; every cron job keeps calling `net.http_post`.
- S3. "Detect cron jobs whose HTTP call fails (`net._http_response`) in `fn_cron_health` and `cron-watchdog` (related: #33)." Each cron HTTP call records its pg_net request id with its job name; `fn_cron_health` returns the latest HTTP outcome per job (status code, timed out, error message), so a 5xx, a timeout or a DNS failure (#506) is visible. Free plan only: no extra Sentry cron monitors (L4).
- S4. "a failing HTTP cron call reaches Sentry": `cron-watchdog` reports a job whose latest HTTP call failed with its own reason and fingerprint. #33 (false alarms) goes in the same commit only if it is small (L3).
- S5. "`purge-old-evidence` through the Storage API (#29): Supabase blocks deleting `storage.objects` from SQL." Retention (L2): evidence of an order is deleted 120 days after the order closed, never while any shipment of that order has an open dispute. Authenticated with the cron secret, idempotent, batched, logged.
- S6. "The purge runs green": a pg_cron job calls the purge function; `cron_jobs.test.sql` and `scripts/guards/cron-jobs.ts` accept it; `docs/go-live.md` section 8 lists it.
- S7. `pg_net.ttl` stays at 6 hours (L2); #541 gets a comment saying what this work covers.

## Tasks

- [x] T1 (S1) bucket limits and paths doc. Inline. PR A, commit C1 `78b72da4`.
- [x] T2 (S2) pg_net to `extensions`. Inline, own commit. PR A, C2 `cb8ce9a1`.
- [x] T3 (S3) cron HTTP request tracking and `fn_cron_health`. Worker (context backstop). Split in two commits (L7): C3a `d73919f2` request tracking (PR A1); C3b health outcome (PR A2).
- T4 (S4) `cron-watchdog` `http-failed`. Inline. PR B, C4.
- T5 (S5) `purge-old-evidence` Edge Function. Inline. PR B, C5.
- T6 (S6, S7) purge cron job, guard, docs, #541 comment. Inline. PR B, C6.

## Log

- L1 (2026-11-15, maintainer): "Seguimos con el roadmap #299 de Supabase en el worktree supabase-health. Toca el ítem 13 (#312): operaciones, limpieza de storage, monitoreo de cron, extensiones y buckets. Antes de nada leé #312 con sus comentarios, y en Engram el último resumen de sesión y roadmap/supabase-health. Investigá primero y proponeme el plan antes de escribir, con los commits por capa. RDD sigue prendido, CodeRabbit ahora es check obligatorio (leé sus comentarios antes de mergear), y Docker se comparte con la sesión de #549: avisale antes de correr Bruno completo o de levantar o parar stacks."
- L2 (2026-11-15, decisions): evidence retention "120 días tras cerrar la orden"; `pg_net.ttl` "Dejar ttl en 6h"; #33 "Solo si es chica".
- L3 (2026-11-15): the maintainer invited pushback on anything non-standard ("tienes libertad de cambiar algo y darle un giro de 360 grados"). Proposal: Sentry cron monitor per function instead of request tracking. Approved: "luz vrede para todo, acepto el cabio y el plan de ataque que propusiste."
- L4 (2026-11-15): Sentry check: the Developer plan includes one cron monitor (used by `cron-watchdog`); more need pay-as-you-go, only on paid plans (Team from 26 USD/month, 0.78 USD per monitor). Maintainer chose "Plan original, gratis": request tracking (S3). A database outage like #541 is covered by the existing `cron-watchdog` monitor.
- L6 (2026-11-16, T3 design): table `internal.cron_http_requests` (request_id bigint PK, jobname text not null, requested_at timestamptz not null default now(), index on (jobname, requested_at desc)), RLS on, no privileges for client roles or service_role (like `internal.cron_leases`). Function `internal.fn_track_cron_request(p_jobname text, p_request_id bigint) returns bigint` inserts the row, deletes rows older than 1 day, returns the id; EXECUTE only for postgres. Each of the HTTP cron commands in `supabase/schemas/_cluster/misc.sql` becomes `select internal.fn_track_cron_request('<its jobname>', net.http_post(...))` (the call text keeps `net.http_post(`, so `cron_jobs.test.sql`'s recorder still swaps it; the recorder must return a distinct id per call). History, not only the latest request, so an intermittent 500 followed by a success is still seen. `fn_cron_health` gains `last_http_status integer` (latest response of the job), `last_http_failed_at timestamptz` and `last_http_error text` (latest failed response: status >= 400 as 'HTTP <code>', timed_out as 'timed out', else error_msg), over tracked requests joined to `net._http_response`; a return type change needs DROP + CREATE. pg_net verified on the local stack after C2: a refused connection leaves a row with `error_msg` 'Could not connect to server'.
- L7 (2026-11-16, delivery): C3 came to about 520 authored lines, so it was split into C3a (table, tracking function, cron commands; migration 20261116020430) and C3b (`fn_cron_health` outcome; migration 20261116020431). C1+C2+C3a reach 424 lines, so the slice boundary moves: PR A1 = C1, C2, C3a; PR A2 = C3b + T4 (the watchdog reports the outcome: "a failing HTTP cron call reaches Sentry"); PR B = T5, T6 (purge). Three PRs instead of two.
- L5 (2026-11-15): remote readback (MCP): `pg_net` 0.19.5 in `public`; `net._http_response` 10 MB, 786 rows, 6 failed; `verification` bucket has no size or MIME limit; the other buckets match the repository.
