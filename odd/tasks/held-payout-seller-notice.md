# Held payout seller notice

Part A of #549 (closes #546 together with Part B): the admin release queue shows why a seller's account cannot be paid and for how long, and the seller is told and reminded. No money rule changes.
Branch `feat/held-payout-seller-notice` from `origin/main`, worktree `C:/dev/School-portal-worktrees/bruno-money-functions`. Engram mirror: `odd/held-payout-seller-notice/tasks`. Decisions: comment on #549 (2026-11-13) and Engram `roadmap/seller-onboarding-held-payouts`.

## Specs

- **S1 — Real reason in the release queue.** "La cola de liberación de admin muestra el motivo real por el que la cuenta no puede cobrar (banco con error, pagos deshabilitados, pagos no manuales, registro rechazado) y los días desde completed_at."
- **S2 — Seller notice.** "Notificación al vendedor (push e in-app) cuando un envío completado no se puede pagar por su cuenta, con link a /sell/onboarding y el motivo en lenguaje simple (es y en)."
- **S3 — Reminders.** "Recordatorios a los 3, 7 y 14 días mientras siga bloqueado."
- **S4 — No money rule changes.** "Hacé primero la Parte A en una rama nueva desde origin/main, sin cambiar reglas de dinero"
- **S5 — Commits by layer, verified locally.** "Creá el documento de la feature en odd/tasks/ y commiteá por capa (SQL, Edge Functions, UI). Verificá en el stack local según AGENTS.md y prendé y apagá el stack vos."
- **S6 — Preserve the maintainer's file.** "supabase/functions/.env.example tiene un cambio mío sin commitear (el bloque de SELENE_CONNECT_ONBOARDING_BRIDGE_URL). No lo pises; preguntame si lo commiteás aparte."

## Tasks

- [x] T1 — S1, S4. SQL: `admin_connect_payout_release_view` gains `seller_payout_block_reason` (`onboarding_rejected`, `onboarding_pending`, or the gate's `blocked_reason` from `fn_get_connect_account_actionability`, only for completed, untransferred, unpaid shipments) and `days_since_completed`. `is_eligible` and `ineligible_reason` are unchanged (L4). pgTAP, `db:types`. Inline. Commit: `730f0ab1`.
- [x] T2 — S2, S3, S4. SQL: event kind `shipment.payout_blocked`, its push policy (seller, orders), `internal.fn_notify_held_payouts()` run by the hourly pg_cron job `held-payout-seller-notices`: one notice per shipment for the latest due stage of 0, 3, 7 and 14 days since `completed_at`, only for reasons the seller can fix (L3). pgTAP `held_payout_notice.test.sql`. Worker (context backstop). Commit: this one.
- [ ] T3 — S1. Edge Function `get-connect-payout-release-queue` returns the new fields. Tests, Bruno. Inline. Commit: pending.
- [ ] T4 — S1. admin-web release queue shows the reason in plain Spanish and the days held. bun tests, Playwright. Inline. Commit: pending.
- [ ] T5 — S2. Frontend: presentation for `shipment.payout_blocked`, title and message in es and en. Tests. Inline. Commit: pending.
- [ ] T6 — S5. Local stack verification (reset, test:db, Bruno, e2e), stack stopped, close. Inline.

## Log

- **L1** — User request, 2026-11-13:

  > Arrancamos el ítem 1 del roadmap #548: #549 (cierra #546), salida para la plata retenida cuando al vendedor le restringen la cuenta después de una venta.
  >
  > Las decisiones ya están tomadas y están en el comentario de #549 y en Engram (roadmap/seller-onboarding-held-payouts). Leelas antes de nada, junto con #546, #548 y los comentarios de los tres. No las vuelvas a discutir.
  >
  > Hacé primero la Parte A en una rama nueva desde origin/main, sin cambiar reglas de dinero:
  >
  > 1. La cola de liberación de admin muestra el motivo real por el que la cuenta no puede cobrar (banco con error, pagos deshabilitados, pagos no manuales, registro rechazado) y los días desde completed_at.
  > 2. Notificación al vendedor (push e in-app) cuando un envío completado no se puede pagar por su cuenta, con link a /sell/onboarding y el motivo en lenguaje simple (es y en).
  > 3. Recordatorios a los 3, 7 y 14 días mientras siga bloqueado.
  >
  > Creá el documento de la feature en odd/tasks/ y commiteá por capa (SQL, Edge Functions, UI). Verificá en el stack local según AGENTS.md y prendé y apagá el stack vos. Antes del primer commit decime qué plan armaste.
  >
  > La Parte B (sección de pagos vencidos a los 30 días y el reembolso excepcional solo para admin) va en un segundo PR, después de mergear A. Antes de B, investigá los límites de tiempo de Stripe para reembolsar un cargo.
  >
  > Nota: supabase/functions/.env.example tiene un cambio mío sin commitear (el bloque de SELENE_CONNECT_ONBOARDING_BRIDGE_URL). No lo pises; preguntame si lo commiteás aparte.

- **L2** — Exploration, 2026-11-13. The reason lives in `internal.connect_account_actionability.blocked_reason` (`payouts_disabled`, `payouts_schedule_not_manual`, `errored`, `verification_failed`, `tokenized_account_number_deactivated`, `destination_undetermined`), read only through `fn_get_connect_account_actionability` (service_role); `rejected` and `pending` come from `profiles_private.stripe_onboarding_status`. The queue reaches admin-web through `get-connect-payout-release-queue` (service role). Notifications store fixed Spanish text and the app renders it as is (#52); owners cannot delete notifications, so `(source_event_key, user_id)` dedupes reminders. Related open issues: #524 (missing actionability row reads as actionable), #52, #178.
- **L3** — Plan presented; maintainer decisions, 2026-11-13: "In-app traducido, push en español (Recomendado)" (the app builds the title and message from the reason code with i18n es and en; push stays Spanish until #52) and ".env.example: Commit aparte en esta rama". The seller is not notified for `payouts_schedule_not_manual` (Selene's setting), `account_refresh_pending`, `destination_undetermined` or a missing actionability row (#524); those show only in the admin queue.
- **L4** — T1, 2026-11-14. Eligibility stays as it was: `fn_begin_shipment_transfer` reads the view, and a blocked account must keep failing with `CONNECT_ACCOUNT_NOT_ACTIONABLE`, which parks the run for auto-resume (S4). The gate function raises on a missing account id and the planner evaluated it even behind a lateral `WHERE`, so the view calls it inside a `CASE` branch; `account_closure_blockers`, `payout_runs_view` and `settlement_single_payment` caught the first two attempts. Evidence: `supabase db reset`, `bun run test:db` 68 files / 2523 tests pass, `db:schema:check` matches, `bun test packages/types scripts/guards` 140 pass.
- **L5** — T2, 2026-11-14, worker. RED: `function internal.fn_notify_held_payouts() does not exist` and the `push_deliveries` allowlist mismatch. GREEN: `supabase db reset`, `bun run test:db` 69 files / 2566 tests pass, `db:schema:check` matches, `bun test scripts/guards` 128 pass. A mutated reason filter failed the per-reason assertions on both sides. The push policy row is a hand-written data migration. The scan reads the whole view hourly; fine at current volume.
