# Shipment cancellations B6: unproven label outcomes and missing rejection tests

Branch `feat/shipment-cancellations-b6` from `origin/main` `5305281`. Parent tracker: `odd/tasks/shipment-cancellations.md` (B6 row). Issue taken: #43.
Scope: the last gaps before shipment cancellation can be called ready: a shipment whose label outcome is unproven (`orphan_pending`) has no way out, and the manual-cancellation rejections M5/M6 have no test. Excluded: #62 (order banner), #46 (Envíos table layout), legacy sandbox rows from before B1.

## Specs

- S1 — Maintainer, verbatim: "lo que literalemnete falte para decir, las cancelaciones de la app ya estan redy y listas casi para prodcuion".
- S2 — Maintainer, verbatim: "al menos que sea un bug real que peude passar de ahora en adelante peus si lo trabajamos pero si son ordenes viejas, muy probelmente esten bugs porque se hicieron con codigo y logica vieja, osea mientras los test de nosotros ma actuales pasen ya olvidate de esos anetriorres." Legacy rows are not repaired or migrated; only the current code path is fixed.
- S3 — Gap 1 (B6.1, issue #43): when Envía's answer to label creation is unproven (timeout, lost connection, malformed response), `generate-shipping-label` marks the shipment `orphan_pending`. From then on the buyer cannot cancel (`SHIPMENT_LABEL_OPERATION_ACTIVE`), the paid-timeout cron skips it (B4 FU2), the seller cannot retry, and nothing calls `fn_reconcile_shipment_label`. The buyer's money stays held with no end. Target: if the label exists at Envía, the shipment continues as generated; if it does not exist, the shipment is released so it can be cancelled and refunded; if Envía cannot confirm, the case goes to an admin bucket.
- S4 — Gap 2 (B6.2): plan cases never tested. M5: "Paid shipment; nonowner | Reject before money; no refund, state, inventory, wallet, or notification effect." M6: "Preparing/shipped/delivered/completed; buyer and seller separately | Reject manual cancellation in every state/role; no refund or state effects." `cancel-order/index.ts:118` (`403 UNAUTHORIZED`) and `:121` (`422 SHIPMENT_NOT_CANCELABLE`) implement them; no test asserts them.
- S6 — B6.1 design. Maintainer chose "Bucket del admin (Recomendado)": an admin "Envíos" bucket lists stuck shipments; the admin checks the Envía panel and chooses "la guía existe" (enters tracking, label URL and cost; the shipment continues as generated) or "no hay guía" (the shipment is released and can be cancelled or refunded). No heuristics, no automatic Envía lookup. Stuck = `paid` with `orphan_pending`, or `claimed`/`generation_sent` whose `claim_expires_at` has passed.
- S5 — Maintainer, verbatim: "Ya saben prs y commits siguiendo las reglas de gentle y las del repo para no querrer meter un cmabio ultra gigante y depues no sea revsable, pero eso tu te encargas."

## Tasks

- B6.1-R | S3 | explore mvsr18pg | Complete (L3).
- B6.1a | S3, S6 | worker | Pending. SQL, own commit: service-only list and resolve RPCs, canonical `fn_reconcile_shipment_label.sql`, harness, Bruno per role. Risk: items 1, 2.
- B6.1b | S3, S6 | worker | Pending. Admin Edge Functions list/resolve (`verify_jwt = true`), handler tests, config, Bruno.
- B6.1c | S3, S6 | worker | Pending. admin-web bucket in "Envíos" (lib, service, hook, bucket, panel), unit tests, Playwright mocked and local.
- B6.2 | S4 | TBD | Pending. Bruno requests for M5 and M6 against the real `cancel-order`.
- B6.C | S1 | parent | Pending. Docs (coordination doc, parent tracker B6 row, go-live), PR, close #43.

## Log

- L1 — Original request, verbatim: "a eso me referia master, lo que literalemnete falte para decir, las cancelaciones de la app ya estan redy y listas casi para prodcuion, a eso me refiero. ENotncees dhco eso si arranca con eso, metelos al plan y trabaja en ello, emepzemos por b6.1. Ya saben prs y commits siguiendo las reglas de gentle y las del repo para no querrer meter un cmabio ultra gigante y depues no sea revsable, pero eso tu te encargas."
- L2 — Evidence for S3 (main `5305281`): `_shared/envia-shipping.ts:208` and `:237` classify transport failures and unknown answers as `orphan_pending`; `generate-shipping-label/index.ts:557` calls `fn_mark_shipment_label_orphan` and only logs CRITICAL (`:605`); `git grep fn_reconcile_shipment_label` finds no caller in Edge Functions or apps. Production has 2 such rows from 2026-09-28 (pre-B1, legacy, left alone per S2).
- L3 — B6.1-R (explore mvsr18pg), docs consulted live: https://docs.envia.com/llms.txt, create label (`POST /ship/generate/`), `GET queries.envia.com/guide/{MM}/{YYYY}`, `GET /guide/{tracking_number}`, `GET /v4/orders`, `POST /ship/generaltrack/`, `POST /ship/cancel/`, webhook types. No idempotency key on create; lookups need the tracking number the lost answer would have returned; `shipment.orderReference` exists but its search mapping is undocumented. Code: `generate-shipping-label` sends no reference (`index.ts:326`); `fn_reconcile_shipment_label` (baseline `:5193`) is admin/service, `paid` + `orphan_pending` only, sets `generated`/`preparing`, no caller and no canonical file; stale `claimed`/`generation_sent` become orphan only lazily on seller retry (`fn_claim_shipment_label`). Releasing to `unclaimed` lets cancellation claims pass and lets `auto-cancel-orders` refund it after expiry; frontend maps paid + `unclaimed` to `ready`. Pattern to copy: B5.8b `shipment_cancellation_late_carrier_activity.sql`, `list-/acknowledge-shipment-late-carrier-activity`, `LateCarrierActivityBucket.tsx`.
- L4 — Maintainer decision recorded as S6.
