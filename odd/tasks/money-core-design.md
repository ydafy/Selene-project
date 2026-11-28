# Money core design (#646)

Roadmap #644, item 2. One design document, `docs/specs/money-core.md`, that items 3 (#647), 4 (#648), and 5 (#649) implement. Docs only. Worktree `money-core`, branch `docs/money-core-design`.

## Specs

Quoted from #646.

- **S1**: "one design document under `docs/specs/` covering: the ledger entries (kinds, sign, idempotency key, which flow writes each one, how balances and the payout amount derive from it)"
- **S2**: "the refund and cancellation records that replace the wide row"
- **S3**: "the order and shipment status model"
- **S4**: "how the existing code paths change"
- **S5**: "how the TLC model in `docs/formal/shipment-transfer-cancellation/` is affected"
- **S6**: "No code." "**Done when** the maintainer approves the document."
- **S7**: The problems the design must solve, from "**Why** (review of 2026-11-16)":
  - "The net amount owed to a seller is stored three times (`order_items.net_payout_cents`, `connect_payout_run_shipments.net_payout_cents`, `connect_payout_runs.amount_cents`); refunds follow two paths; cancellation losses live in two tables; the Seguro Selene amount has no column of its own. Nothing answers \"what did Selene owe this seller on day X\" without joining five tables."
  - "`shipment_cancellation_operations` holds five lifecycles in one row (claim, Stripe refund, carrier cancellation, admin review, late carrier activity) with 37 columns and about 25 nullability CHECKs; `refund_status` is overwritten, so a failed and retried refund leaves no trace."
  - "`orders.status` is a stored copy kept by a trigger from `fn_derive_order_status`, which returns `cancelled` for a multi-seller order where one shipment was cancelled and the other delivered. `shipments.status` uses the order enum."

## Tasks

- [ ] T1 S7: map the current money core (writers, readers, amounts, states, open findings). Route: 3 `gentle-ai-explore` in parallel. Commit: none (evidence goes into T2-T5).
- [ ] T2 S1, S6: ledger section. Route: inline. Commit: pending.
- [ ] T3 S2, S6: refund and cancellation records section. Route: inline. Commit: pending.
- [ ] T4 S3, S6: order and shipment status model section. Route: inline. Commit: pending.
- [ ] T5 S4, S5, S6: code path changes, TLC impact, implementation order for #647, #648, #649. Route: inline. Commit: pending.
- [ ] T6 S6: maintainer review, PR `Closes #646`, merge after approval. Route: inline. Commit: pending.

## Log

- **L1** (2026-11-27, maintainer): "okye master vamos a continuar este roadmap. SObre la otra seison, es un cambio casi de doc, no es nada fuerte, igual comunicate con la sesion para que no se picen. ENotnces arrancaremos con #646 en esta sesion, aqui tu divides todo como rceas que sea mejor, recuerda que no etsamos obligados a terminar el issue aqui en la sesion, siempre podemos hacre A, B y dejar C para otra seison, eso lo deicdesd tu, esto te lo comento para no llenar mcuho la venatna de contexto, tu me iras diciendo conforme trabajes y segun tu predicion. Lo demas ya sabes, tu decides si pr encadenadas y todo eso para que se cumpla rdd y todo eso."
- **L2** (2026-11-27): #636 and #637 closed on 2026-11-17 and roadmap #299 closed on 2026-11-27, so nothing blocks item 2. The main checkout session was told about this worktree and its heavy steps.
