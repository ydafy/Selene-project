# Held payout overdue refund

Part B of #549 (closes #546 with Part A, `odd/tasks/held-payout-seller-notice.md`): after 30 days a held, never-transferred shipment moves to an "overdue payouts" section of the admin queue, where an admin keeps holding it with a note or, only when Stripe rejected the seller's account, refunds the buyer.
Branch `feat/held-payout-overdue-refund` from `origin/main` (`7fd68c8d`), worktree `C:/dev/School-portal-worktrees/bruno-money-functions`. Engram mirror: `odd/held-payout-overdue-refund/tasks`. Decisions: comment on #549 (2026-11-13) and Engram `roadmap/seller-onboarding-held-payouts`.

## Specs

- **S1 — Overdue section.** "A los 30 días desde completed_at, el envío pasa a una sección "pagos vencidos" en la cola de admin. Nada se reembolsa solo."
- **S2 — Admin decision.** "El admin puede seguir reteniendo (con una nota) o reembolsar al comprador."
- **S3 — Refund exception.** "Excepción aprobada a "reembolsos solo antes de completar": solo admin, solo si Stripe rechazó la cuenta del vendedor, solo si nunca se inició una transferencia del envío, y el reembolso de Stripe tiene que salir bien antes de que la base lo registre."
- **S4 — Stripe refund limits.** "Antes de planear, terminá de investigar los límites de Stripe para reembolsar un cargo. Ya sabemos que con tarjeta no hay plazo pero puede fallar si la tarjeta venció o se canceló (la plata vuelve al saldo en hasta 30 días); confirmá los métodos de pago que usa Selene de verdad (OXXO, transferencia, etc.) y qué pasa con cada uno."
- **S5 — Commits by layer, reviewed, verified locally.** "Commiteá por capa (SQL, Edge Functions, UI) y pasale la revisión nativa a cada commit de SQL o dinero apenas lo commitees, no a la rama entera al final. No lances revisiones mientras corren suites o Docker. Verificá en el stack local según AGENTS.md y prendé y apagá el stack vos."

## Tasks

Plan approved by the maintainer (L4).

- [x] T1 — S1, S2. SQL: append-only `shipment_payout_hold_notes` (admin, note, time; RLS on, no client grants) and its admin RPC with an `admin_audit_logs` row; the release view adds `is_payout_overdue` (completed, unpaid, no transfer ever started, a seller block reason, 30 days or more since `completed_at`) and the latest hold note; `fn_get_admin_payout_queue` gains the `overdue` bucket. Eligibility unchanged. pgTAP, `db:types`. Review. Worker (context backstop). Commit: the `feat(payouts): move held shipments to an overdue bucket` commit.
- [ ] T2 — S3. SQL (money): refund of a completed shipment through `shipment_cancellation_operations` with a new source, so the existing fence in `fn_begin_shipment_transfer` keeps blocking transfers once the refund starts. The amount is the cancellation amount (L4) and the loss (shipping already paid plus the actual Stripe fee) is recorded. Claim guards: active admin, `completed`, overdue, `stripe_onboarding_status = 'rejected'`, no `transfer_started_at` in `connect_payout_run_shipments`, no `stripe_transfer_id` or `stripe_payout_id`, shipment row locked first. The shipment becomes `refunded` only with `refund_status = 'succeeded'` (direct or from `refund.updated`); a parked payout run mapping is closed. pgTAP including transfer-after-claim and claim-after-transfer. Review. Commit: —
- [ ] T3 — S3. TLC model: `completed → refunded` guarded by "no transfer started"; invariants that a refunded shipment is never transferred and a started transfer blocks the refund. Code mapping table and sync commit. Commit: —
- [ ] T4 — S1, S2. Edge Functions: `get-connect-payout-release-queue` returns the new columns and the `overdue` bucket (its `counts` check pins 4 keys today, so T1's migration and this function deploy together, L5); admin-only hold-with-note function. Overdue shipments inside a parked run stay in their run group; the response carries `is_payout_overdue` per shipment so the admin can act there too (L5). Tests, Bruno. Commit: —
- [ ] T5 — S3, S4. Edge Function (money): admin-only overdue refund. Checks Stripe live (`requirements.disabled_reason` starts with `rejected.`), allows only `card` charges, computes the amount on the server, Stripe refund before the record RPC, idempotency key per shipment, recovery as in `runShipmentCancellation`. Tests, Bruno and the Stripe sandbox folder. Review. Commit: —
- [ ] T6 — S1-S3. admin-web: overdue section, hold-with-note dialog, refund confirmation offered only for a rejected account. bun tests, Playwright. Commit: —
- [ ] T7 — S4. `docs/go-live.md`: confirm the live payment method configuration offers only cards (Apple Pay, Link and Google Pay are cards). Commit: with T5.
- [ ] T8 — S5. Local stack verification (reset, `test:db`, Bruno with the Stripe sandbox folder, e2e, a real overdue scenario), stack stopped. Commit: —

## Log

- **L1** — User request, 2026-11-13:

  > Arrancamos la Parte B de #549 (roadmap #548, ítem 1). La Parte A ya está mergeada (#566) y en
  > producción; su documento es odd/tasks/held-payout-seller-notice.md.
  >
  > Las decisiones ya están tomadas: comentario de decisiones en #549 y Engram
  > roadmap/seller-onboarding-held-payouts. Leelas antes de nada, no las vuelvas a discutir.
  >
  > Parte B:
  >
  > 1. A los 30 días desde completed_at, el envío pasa a una sección "pagos vencidos" en la cola de
  >    admin. Nada se reembolsa solo.
  > 2. El admin puede seguir reteniendo (con una nota) o reembolsar al comprador.
  > 3. Excepción aprobada a "reembolsos solo antes de completar": solo admin, solo si Stripe rechazó la
  >    cuenta del vendedor, solo si nunca se inició una transferencia del envío, y el reembolso de Stripe
  >    tiene que salir bien antes de que la base lo registre.
  >
  > Antes de planear, terminá de investigar los límites de Stripe para reembolsar un cargo. Ya sabemos
  > que con tarjeta no hay plazo pero puede fallar si la tarjeta venció o se canceló (la plata vuelve al
  > saldo en hasta 30 días); confirmá los métodos de pago que usa Selene de verdad (OXXO, transferencia,
  > etc.) y qué pasa con cada uno.
  >
  > Rama nueva desde origin/main en el worktree bruno-money-functions. Creá el documento de la feature
  > en odd/tasks/ y decime el plan antes del primer commit. Commiteá por capa (SQL, Edge Functions, UI) y
  > pasale la revisión nativa a cada commit de SQL o dinero apenas lo commitees, no a la rama entera al
  > final. No lances revisiones mientras corren suites o Docker. Verificá en el stack local según
  > AGENTS.md y prendé y apagá el stack vos.

- **L2** — Stripe research, 2026-11-13 (Stripe docs and the sandbox through the MCP).
  - Checkout uses `automatic_payment_methods` (`create-connect-payment/single-payment-builder.ts:517`), so the Dashboard's payment method configuration decides what buyers see. Sandbox `Default` configuration: card, Apple Pay and Link on; Bancontact and EPS on but EUR-only, never offered for MXN; Google Pay off; OXXO and bank transfers (`customer_balance`) unavailable. The last 100 sandbox charges are all `card` with no wallet. The live configuration is not readable here (the MCP is sandbox only).
  - Card (Apple Pay, Google Pay and Link pay with a card): no refund window. An expired or canceled card is usually credited by the issuer to the replacement card; in rare cases the refund fails (`refund.failed`, `expired_or_canceled_card`, `lost_or_stolen_card`, `declined`) and the money returns to the platform balance within 30 days. A refund larger than the available balance stays `pending` and fails with `insufficient_funds` after 45 days.
  - OXXO: cannot be refunded through Stripe, full or partial; it needs a separate process.
  - Mexico bank transfers (SPEI): 180 days from the payment, asynchronous up to 5 business days, cannot be canceled; it can sit in `requires_action` while Stripe emails the buyer for a bank account; it fails at once if the available balance does not cover it.
  - Selene uses separate charges and transfers, so the platform balance pays the refund and Stripe's processing fee is not returned.
- **L3** — Exploration, 2026-11-13. The cancellation machinery (`_shared/cancellation/shipment-cancellation.ts`, `shipment_cancellation_operations`, claim, start, record, `fn_cancel_shipment`) is the Stripe-before-DB pattern to reuse; its operation row is already the fence `fn_begin_shipment_transfer` checks. Its amount (`refund-basis.ts`) is the item subtotal plus the proportional Seguro share. The dispute refund path calls Stripe with no write-ahead row; not copied. "Transfer ever started" is `connect_payout_run_shipments.transfer_started_at` (never cleared) or `shipments.stripe_transfer_id` / `stripe_payout_id`. `stripe_onboarding_status = 'rejected'` is broader than Stripe's `rejected.*` (any non-past-due `disabled_reason`, such as `under_review`), and the raw reason is not stored; accounts are read through the v1 API, so the refund function can read `requirements.disabled_reason` live. The TLC model has no transition out of `completed`. No payout hold note exists. `refund.updated` and `refund.failed` reach `fn_apply_shipment_cancellation_refund_event`, which completes only `paid` or `preparing`. Related open items: #546 (closes), #96, #524, #97 (the cancellation formula's 1-cent rounding), #101, #484, and a draft advisory about suspended admins in `release-connect-payout` (the new functions use `isActiveAdmin`).
- **L4** — Maintainer decisions, 2026-11-13. Refund amount, after clarifying that the buyer pays product plus Seguro Selene and the seller absorbs shipping from the payout: "aa ya, entonces si, lo perdemos, al menos que me digas que ae otra ocpion, pero aplcia como la misma logica de cancelar no? [...] es parte del riesgo". So the refund is what the buyer paid for that shipment, computed as a cancellation (item subtotal plus the proportional Seguro share); Selene absorbs the shipping it already paid and the Stripe fee, and the loss is recorded per shipment from Stripe transaction data. Plan: "Lo de los cambios pense que era esto, asi que no ae cambios."
- **L5** — T1, 2026-11-14, worker; the parent fixed four admin-web fixtures outside the worker's surfaces. Migration `20261114052734_payout_overdue_hold_notes` (generated, reviewed; the `btrim` whitespace set fixed by hand). RED: 53/53 failed on `column "is_payout_overdue" does not exist`. GREEN: `supabase db reset`, `bun run test:db` 74 files / 2678 tests, `db:schema:check` matches, `bun test packages/types scripts/guards supabase/functions/get-connect-payout-release-queue` 174 pass, admin-web typecheck exit 0, `bun test apps/admin-web/src/features/payments` 163 pass. Mutation (no transfer-started guard, 29 days) failed 9/53. Notes: (1) the deployed queue function rejects `counts` without exactly 4 keys, so this migration and T4 ship together; (2) a shipment inside a run (for example parked as `account_not_actionable`) keeps its run group, only run-less shipments move to `overdue`; (3) append-only is enforced by grants and RLS, `service_role` keeps UPDATE and DELETE, and every note is duplicated in `admin_audit_logs`.
