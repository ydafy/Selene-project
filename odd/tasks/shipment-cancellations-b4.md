# Shipment cancellations B4: carrier evidence, label outcome and guarded tracking

Branch `feat/shipment-cancellations-b4` from `origin/main` `0d9e59e` plus cherry-pick `5390035` (B3 publication docs). Parent tracker: `odd/tasks/shipment-cancellations.md` (B4 row, R9-R12, FU2 in B14-L5). Inherited from B3: `odd/tasks/shipment-cancellations-b3.md` L14, L16, L20.
Scope: preparing timeout cancels the Envia label before any refund, fresh tracking before acting, carrier refusal/ambiguity to review, label-cost loss recorded separately, FU2 orphan exclusion, preparing cron scheduled with an observed run. Excluded: orphan label recovery (`label-recovery-backlog.md`), UI and messaging (B5).

## Specs

- S1 — Tracker B4 scope: "Fresh carrier evidence and explicit label outcome; tracking cannot resurrect cancellation; uncertainty routes to review."
- S2 — R9: "Old preparing/no handoff: label cancellation confirmation separate from label money returned."
- S3 — R10: "Handoff, stale/missing/unrecognized tracking: fail closed/manual review."
- S4 — R11: "Carrier refusal/ambiguous cancel; tracking cannot resurrect cancelled shipment."
- S5 — R12: "Label-cost loss recorded separately; no guaranteed label refund."
- S6 — FU2 (B14-L5): "orphan_pending paid shipments are retried and rejected every hourly run forever — orphan reconciliation/expiry policy is B4"; with B3-L14 R4: "if 50+ old paid shipments fail on every run (FU2 `orphan_pending`), newer expired shipments would never be selected."
- S7 — B3-L20: "Moved to B4: scheduling `auto-cancel-preparing`, oldest-first/FU2 starvation (L14), and the remaining advisories (silent 401 alerting, executed budget-deferral test, duplicated settings validation)."
- S8 — Carrier-refusal policy (decided in L3): the carrier accepting the cancellation is the only path to an automatic refund; a refusal re-reads tracking; a carrier scan lets tracking advance the shipment (no cancellation, no refund); a refusal without a scan, an ambiguous carrier answer or unrecognized tracking goes to admin review with no refund.

## Tasks

- B4.1 | S6 | parent | Pending. Paid-timeout candidates exclude shipments with a label operation in flight or `orphan_pending`; they are reported for review instead of retried every run. Risk: low.
- B4.2 | S2, S5, S8 | parent | Pending. SQL: carrier cancellation outcome on the cancellation operation (`accepted` / `refused` / `ambiguous`), `balanceReturned` and date, label-cost loss in cents separate from the buyer refund; service-only RPCs. Risk: item 1 (money/SQL). Own commit.
- B4.3 | S3, S4 | parent | Pending. Envia adapter: fresh tracking read for one shipment and `POST /ship/cancel/` classified into accepted / refused / ambiguous; unrecognized statuses fail closed. Unit tests from the documented contract.
- B4.4 | S1, S4, S8 | parent | Pending. Wire `auto-cancel-preparing`: fresh tracking, carrier cancel, refund only on `accepted`; refused/ambiguous to review per S8. Real-SQL test that tracking cannot resurrect a cancelled shipment. Admin can see and resolve the review case (check existing refund-problems flow first). Risk: item 1 (money). Own commit.
- B4.5 | S1-S5 | parent + maintainer | Pending. Envia sandbox validation of `/ship/cancel/`, served-function harness, Bruno requests.
- B4.6 | S7 | parent + maintainer | Pending. Schedule `auto-cancel-preparing` from Vault (`docs/go-live.md`), observe a real run via MCP, closure docs.
- B4.7 | S7 | parent | Pending, optional. B3 advisories: alert on cron 401, executed budget-deferral test, shared settings validation.

## Log

- L1 — Original request, verbatim: "master, arrancamos B4 de shipment cancellations en el worktree shipment-cancellations. Leé odd/tasks/shipment-cancellations.md (roadmap, R9–R12, FU2) y odd/tasks/shipment-cancellations-b3.md (L14, L16, L20: lo que pasó a B4), y el resumen de Engram en selene-project. Creá la rama feat/shipment-cancellations-b4 desde main y primero revisemos el alcance y la política de rechazo del carrier. P.D asegurate que este woktree estae actualziado con lomas reciente de man anets de empezar."
- L2 — Read-only findings (Engram 2574): `auto-cancel-preparing` refunds with no Envia call (label stays live, label cost unrecorded, no fresh tracking before refund); claim allows `preparing` + `generated`. Remote `fn_record_tracking_event` already ignores transitions for `cancelled` (no real-SQL test). Envia `POST /ship/cancel/` (https://docs.envia.com/reference/cancel-shipment.md, updated 2026-07-07): `carrier` + `trackingNumber`; response `data.balanceReturned`, `data.balanceReturnDate`; fails if scanned or outside the carrier window; no documented refusal reason codes. Sandbox: 2 `paid` + `orphan_pending` (FU2), 1 `preparing` + `generated` with tracking since 2026-10-19 (first candidate once scheduled).
- L3 — Maintainer, verbatim: "okey me gusto tu lpan actualiza el roadmap me refiero a el generar este wokree y engram. Ahroa que hacer, supongo que si manual ya que va ser un caso raro o un edge case, normallmente el carrier no va cancelar la guia tan facil, y si si la cancela pues hmm, no se, me gusta lo automatico, osea entre meno tiempo perdamos en estas cosas mejor pero entiendo el otro lado, no te podria decir, que opinas tu y rctees que sea el mejor plan para el mvp++ pero tamebin escalable? osea que dentro de 1 o 9 meses si no modifico esto va ser bueno y no va ver ncecesidad de cambiarlo". Plan accepted. Policy delegated to the agent: S8 (automatic when the carrier gives proof either way, manual only when it gives none). Reason: Envia documents no refusal reasons, so automatic refund on refusal risks paying the buyer while the package travels; re-reading tracking resolves the common refusal (already scanned) without a human.
