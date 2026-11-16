# Operations: storage cleanup, cron HTTP monitoring, pg_net, bucket limits

Roadmap #299 item 13, issue #312 (closes #29). Branch `feat/ops-cron-storage` from `origin/main` c746e746, worktree supabase-health.
Two PRs: A (database: C1-C3) and B (Edge Functions and the purge job: C4-C6).

## Specs

- S1. "Size and MIME limits on every bucket; document each bucket and its expected paths in `docs/go-live.md` section 4." `verification` (the only bucket without limits) gets limits that match what the app uploads: camera photos through `buildVerificationProofUpload` (`<product_id>/<prefix>_<timestamp>.<ext>`), so private, 10 MiB, JPEG, PNG, WebP, HEIC, HEIF. pgTAP `storage_access.test.sql` pins every bucket.
- S2. "Move `pg_net` to the `extensions` schema." The advisor `extension_in_public` no longer reports it; every cron job keeps calling `net.http_post`.
- S3. "Detect cron jobs whose HTTP call fails (`net._http_response`) in `fn_cron_health` and `cron-watchdog` (related: #33)." Each cron HTTP call records its pg_net request id with its job name; `fn_cron_health` returns the latest HTTP outcome per job (status code, timed out, error message), so a 5xx, a timeout or a DNS failure (#506) is visible. Free plan only: no extra Sentry cron monitors (L4).
- S4. "a failing HTTP cron call reaches Sentry": `cron-watchdog` reports a job whose latest HTTP call failed with its own reason and fingerprint. #33 (false alarms) goes in the same commit only if it is small (L3).
- S5. "`purge-old-evidence` through the Storage API (#29): Supabase blocks deleting `storage.objects` from SQL." Retention (L2): evidence of an order is deleted 120 days after the order closed, never while any shipment of that order has an open dispute. Authenticated with the cron secret, idempotent, batched, logged.
- S6. "The purge runs green": a pg_cron job calls the purge function; `cron_jobs.test.sql` and `scripts/guards/cron-jobs.ts` accept it; `docs/go-live.md` section 8 lists it.
- S7. `pg_net.ttl` stays at 6 hours (L2); #541 gets a comment saying what this work covers.

## Tasks

- T1 (S1) bucket limits and paths doc. Inline. PR A, commit C1.
- T2 (S2) pg_net to `extensions`. Inline, own commit (risk 3/5). PR A, C2.
- T3 (S3) cron HTTP request tracking and `fn_cron_health`. Inline. PR A, C3 (split if over ~400 lines).
- T4 (S4) `cron-watchdog` `http-failed`. Inline. PR B, C4.
- T5 (S5) `purge-old-evidence` Edge Function. Inline. PR B, C5.
- T6 (S6, S7) purge cron job, guard, docs, #541 comment. Inline. PR B, C6.

## Log

- L1 (2026-11-15, maintainer): "Seguimos con el roadmap #299 de Supabase en el worktree supabase-health. Toca el ítem 13 (#312): operaciones, limpieza de storage, monitoreo de cron, extensiones y buckets. Antes de nada leé #312 con sus comentarios, y en Engram el último resumen de sesión y roadmap/supabase-health. Investigá primero y proponeme el plan antes de escribir, con los commits por capa. RDD sigue prendido, CodeRabbit ahora es check obligatorio (leé sus comentarios antes de mergear), y Docker se comparte con la sesión de #549: avisale antes de correr Bruno completo o de levantar o parar stacks."
- L2 (2026-11-15, decisions): evidence retention "120 días tras cerrar la orden"; `pg_net.ttl` "Dejar ttl en 6h"; #33 "Solo si es chica".
- L3 (2026-11-15): the maintainer invited pushback on anything non-standard ("tienes libertad de cambiar algo y darle un giro de 360 grados"). Proposal: Sentry cron monitor per function instead of request tracking. Approved: "luz vrede para todo, acepto el cabio y el plan de ataque que propusiste."
- L4 (2026-11-15): Sentry check: the Developer plan includes one cron monitor (used by `cron-watchdog`); more need pay-as-you-go, only on paid plans (Team from 26 USD/month, 0.78 USD per monitor). Maintainer chose "Plan original, gratis": request tracking (S3). A database outage like #541 is covered by the existing `cron-watchdog` monitor.
- L5 (2026-11-15): remote readback (MCP): `pg_net` 0.19.5 in `public`; `net._http_response` 10 MB, 786 rows, 6 failed; `verification` bucket has no size or MIME limit; the other buckets match the repository.
