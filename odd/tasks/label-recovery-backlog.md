# Backlog: shipping label failure recovery

Deferred block from the 2026-10-18 `generate-shipping-label` audit. Not started.
Prerequisite context: evidence hardening is done (`eb3643c`, `a39536d`, deployed and sandbox-verified).

## Specs

- S1 (user strategy, verbatim): "un boton para cuando pase este caso en el futuro, donde usairo pulsa -> buscamos en envia o conslutamos, si si esta, actualizar y mandar al usario a order\id, si incluso al buscar y nisiquiera esta generada en envia y en nuestra basde de datos tapoco esta o esta como fail, peus ahi si contactar soporte."
- S2: Never purchase a second label while the first outcome is unknown.
- S3: A claim that expired before `mark-sent` (Envia never called) should become retryable instead of `orphan_pending`.
- S4: "Consultar estado" must tell the seller when the status did not change.
- S5: A network failure while quoting must not be shown as "Paquetexpress unavailable".

## Known constraints

- Official Envia docs (consulted 2026-10-18): `GET /guide/{MM}/{YYYY}` filters only by month/year; `GET /guide/{tracking_number}` returns status, origin, destination and dates. No lookup by client reference; neither returns label URL, service or cost.
- Today the generate request sends no shipment reference to Envia.
- Matching must be strict: exactly one candidate in the claim window with the same origin/destination and carrier; otherwise route to support.
- Existing admin reconciliation RPC is not called by any app; there is no automatic reconciler.

## Tasks

- R1 [S3] Release expired never-sent claims to retryable (claim RPC, migration + maintainer deploy).
- R2 [S4] "Status unchanged" feedback on the recovery card.
- R3 [S5] Distinguish quote network failure from carrier unavailability.
- R4 [S1,S2] Sandbox spike: identify a label without ambiguity and retrieve its PDF by tracking number.
- R5 [S1,S2] When Envia accepted but DB finalize failed, retry finalize from the in-memory response before orphaning.
- R6 [S1,S2] Seller-triggered server lookup + reconcile button; route to `order/[id]` on success, support otherwise.
- R7 Manual reconciliation of existing stuck sandbox/test shipments (support/admin).

## Log

- L1 2026-10-18: User approved the S1 strategy and asked to keep it as a separate later block; continue the original roadmap first. Engram: 2492, 2493, 2495.
