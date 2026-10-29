# Dispute integrity

Hardens how disputes are opened, confirmed and refunded so every refund state in the database matches a real Stripe refund and only shipments that are not yet completed can be disputed. Branch `fix/dispute-integrity`, worktree `security-advisories`. Details of the underlying reports are kept outside the repository until the fix is deployed.

## Specs

- **S1** A Stripe Connect shipment is marked refunded only after its Stripe refund. `fn_seller_confirm_return_shipment` (no callers) is removed; the shipment refund RPC refuses Connect shipments.
- **S2** A dispute opens only for a shipment that is `shipped` or `delivered`, inside 48 hours of that shipment's own `delivered_at`, with no started cancellation refund. The check and the insert run in one transaction that locks the shipment row.
- **S3** A dispute refund runs only while the disputed shipment is `shipped` or `delivered`. The Edge Function checks this before calling Stripe, and after the Stripe refund succeeds a guarded RPC marks the shipment refunded and resolves the dispute in one transaction.
- **S4** Read the remote project (read-only) for existing rows that the old behavior may have produced, and report them to the maintainer.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1 | inline | b396380 |
| T2 | S2 | worker | 55ef13e |
| T3 | S3 | worker | f681c4a |
| T4 | S4 | inline | none (read-only, see L5) |

## Log

- **L1** (2026-10-28, maintainer): "master quero abrir un woktree para trabajar espesificamente los Security Advisories que etsana ctuivos que son 3, dime cual es tu plan? o que opinas?"
- **L2** (2026-10-28, maintainer): "si confirmo el cierre de hqcg wallet ya quedo borrado. trabajaemos los fixes en un woktree, mas simple. Sobre repo publico tienes razon yo lo dejo publico [...] por mientras lo dejamos asi, cuando termnes me dices que recomeindas."
- **L3** One of the three advisories was already fixed and deployed (the legacy wallet functions no longer exist remotely); closed on 2026-10-28. Two remain, covered by S1-S3.
- **L4** Open issues near this area, not covered here: #54, #59.
- **L5** T4, remote read 2026-10-28 (3 disputes in total): no dispute was confirmed by a seller or forced by an admin through the removed function, no dispute was opened after its shipment completed, and no Connect shipment is `refunded`. A separate finding in the same area was reported privately to the maintainer.
- **L6** (2026-10-28, maintainer): "master migracion aplicada succes y las dos deploy's de las EF. dime que sigue y si todo esta bein o que quieres haecer." Remote read confirmed the three migrations and both functions; types regenerated in 3dae8c7 (this branch's hunks only).
