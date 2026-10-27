# Shipment transfer vs shipment cancellation (TLA+)

A TLA+ model, checked with TLC, of how the release of a shipment's funds (Stripe `transfers.create`) and the cancellation of that shipment (Stripe refund) exclude each other. It checks that a shipment is released for its full amount or not at all, once, and never after a cancellation refund started.

Disputes and returns are out of scope for this model.

Files: `ShipmentTransferCancel.tla` (model and properties), `ShipmentTransferCancel.cfg` (the faithful model and its bounds).

## Sync with the code

| Item | Value |
| --- | --- |
| Synced against | `origin/main` `adb63322ed13f82b23d1172d4f8c4391b4616cbb` |
| Files and functions covered | the table below |
| Files unchanged since the sync commit | all files in the table (checked with `git diff adb63322 HEAD` on `supabase/queries/payments`, `supabase/queries/orders`, `supabase/queries/shipments/fn_claim_shipment_label.sql`, `supabase/functions/release-connect-payout`, `supabase/functions/cancel-order`) |

When any file in the mapping table changes, re-read its row and update the model and this table.

## Run it

Requires Java 21 and the TLC jar. Pinned: `tla2tools.jar` with sha256 `d15655eeaff4b3f7b3d65c46b838bc0f35d131b2ef4b1e473689b62c98d4726f`, which prints `TLC2 Version 2026.10.24.013619 (rev: 2ef2af8)` (installed as TLC 1.8.0). Check the hash before trusting a result.

```sh
export TLA2TOOLS=/path/to/tla2tools.jar
sha256sum "$TLA2TOOLS"    # must print the hash above
cd docs/formal/shipment-transfer-cancellation
java -XX:+UseParallelGC -cp "$TLA2TOOLS" tlc2.TLC -workers auto -deadlock \
  -metadir "$(mktemp -d)" -config ShipmentTransferCancel.cfg ShipmentTransferCancel.tla
```

`-deadlock` turns off the deadlock check: the model ends in terminal states (everything released or cancelled) by design. `-metadir` keeps TLC scratch output out of the repository.

Last result (Windows 11, Temurin 21.0.12.1, 2026-10-25): `Model checking completed. No error has been found.` 3,295,096 states generated, 995,560 distinct states, depth 29, 4 s.

## Properties

Each is an invariant in the `.tla` file and in the `.cfg`.

| Property | Plain sentence | Harm if it breaks |
| --- | --- | --- |
| `FullOrNothing` | The money transferred for a shipment is either 0 or exactly its release amount. | The seller is paid part of what they are owed, or paid twice. |
| `NoTransferAfterCancel` | Once a transfer is started or made, no cancellation operation is started and the shipment is not cancelled or refunded; and a cancelled or refund-started shipment is never transferred. | The buyer is refunded and the seller is also paid, or the reverse. |
| `AtMostOneTransfer` | At most one Stripe transfer exists per shipment across runs and retries. | Selene pays out the same shipment through two transfers. |
| `RefundBeforeCancel` | A shipment is cancelled only after its refund succeeded. | The shipment is cancelled while the buyer has not been refunded. |

## Code mapping

Every action maps to one named code step. Error names are the `RAISE EXCEPTION` codes in the source.

| Model action | Code step | Guards modeled (switch) |
| --- | --- | --- |
| `Progress`, `ConfirmDelivery` | status moves to `delivered`; `fn_confirm_shipment_delivery` in `supabase/queries/orders/fn_confirm_shipment_delivery.sql` sets `completed` | none from the cancellation operation (see assumption 1) |
| `Reprice` | inputs of `release_amount_cents` in `admin_connect_payout_release_view_shipping_cost_fix.sql` change | assumption 2 |
| `CreateRun` | `releaseConnectPayout` in `supabase/functions/release-connect-payout/release-connect-payout.ts`: `assertEligibleRows` (all `completed`), `deps.createRun`, `deps.createRunShipments`; one retry child per run (`idx_connect_payout_runs_one_retry_per_parent`); no second active mapping | |
| `FailRun` | a pending run becomes `failed` and its mappings `failed` | the fence stays set (column comment on `transfer_started_at`) |
| `Begin` | `fn_begin_shipment_transfer` in `supabase/queries/payments/shipment_transfer_coordination.sql` | run `pending_reconciliation` with no retry child; mapping `pending_reconciliation`; `SHIPMENT_CANCELLATION_OPERATION_ACTIVE` (`G_BeginOp`); `SHIPMENT_FUNDS_ALREADY_RELEASED`; `SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED` (`G_BeginFence`); `SHIPMENT_NOT_COMPLETED`; `net_payout = release_amount_cents` and the returned amount is the view amount (`G_BeginAmount`); no other run's active mapping; writes `transfer_started_at` before returning (`G_WriteAhead`) |
| `StripeTransfer` | `createStripeTransfer` in `supabase/functions/release-connect-payout/index.ts` (`stripe.transfers.create`) with key `run.idempotency_key:run_id:shipment_id` (`buildTransferIdempotencyKey`) | same key returns the same transfer; another run creates another |
| `CompleteTransfer` | `fn_complete_shipment_transfer` | run, mapping and token still match; sets `shipments.stripe_transfer_id`; never clears the fence |
| `WorkerCrash` | process dies between `Begin`, the Stripe call and `CompleteTransfer`; the worker or a retry starts again at `Begin` | |
| `ClaimCancel` | `fn_claim_shipment_cancellation` in `shipment_transfer_coordination.sql` (replaces `shipment_cancellation_coordination.sql`) | status `paid`; `SHIPMENT_FUNDS_ALREADY_RELEASED`; `SHIPMENT_TRANSFER_OPERATION_ACTIVE` (`G_ClaimFence`); token rotation on an expired claim; `busy` and `recovery_required` change nothing |
| `ExpireClaim` | `claim_expires_at <= clock_timestamp()` | |
| `StartRefund` | `fn_start_shipment_cancellation_refund` (`shipment_cancellation_refund_request.sql`) calling `fn_start_shipment_cancellation`; sets `external_started_at`, never cleared | `STALE_CANCELLATION_CLAIM`; `CANCELLATION_CLAIM_EXPIRED`; `SHIPMENT_NOT_CANCELABLE` (`G_StartStatus`); `SHIPMENT_FUNDS_ALREADY_RELEASED` (`G_StartFunds`); `SHIPMENT_TRANSFER_OPERATION_ACTIVE` (`G_StartFence`) |
| `StripeRefund` | `stripe.refunds.create` in `supabase/functions/cancel-order/index.ts` with the frozen request; idempotent, retried by any caller | |
| `RecordRefund` | `fn_record_shipment_cancellation_refund` with `succeeded` (`shipment_cancellation_refund_status.sql`) | |
| `CancelShipment` | `fn_cancel_shipment` in `supabase/queries/orders/fn_cancel_shipment.sql` | status `paid`/`preparing` (`CANNOT_CANCEL_IN_THIS_STATUS`); `REFUND_NOT_SUCCEEDED` (`G_CancelRefund`) |

## Bounds

Two shipments (`s1`, `s2`), two cancellation actors (`a1`, `a2`; buyer, cron, admin are interchangeable), two runs (`r1` and its retry child `r2`, both covering both shipments), at most 3 claim-token rotations per shipment. A `preparing` shipment behaves like `paid` for every guard here, so one `paid` state stands for both.

## Assumptions and exclusions

1. Steps from `paid` to `completed` (label, carrier tracking, delivery confirmation) are modeled as not checking the cancellation operation, whether or not the code does. Only the guards in the mapping table are credited.
2. The release amount can change once, and only before any transfer fence or Stripe transfer exists. Not checked against the code.
3. A pending run can fail at any moment (the model does not distinguish why).
4. Stripe idempotency keys are treated as permanent. Real keys expire, which is why the model also relies on the `transfer_started_at` fence.
5. Refund status is reduced to "none" and "succeeded". The `failed`, `canceled`, `pending` and `requires_action` refund states, `refund_resolved_at` and the admin resolution of a failed refund are not modeled.
6. Not modeled: `payouts.create` and the balance preflight after the transfers, `paid` mappings, executor claims on runs, label generation states, wallets (deprecated), authorization and the service-role check, lock ordering and deadlocks (each SQL function is one atomic action, which holds because each locks the shipment first).
7. Safety only. Liveness (every started operation eventually finishes) is not checked.
8. Model checking covers the bounds above, not all sizes. It proves nothing about code beyond the rows in the mapping table.

## Broken variants

Each variant turns one or more `G_*` constants to `FALSE` in a temporary copy of the `.cfg` and checks one property at a time. "States in trace" is the length of the shortest counterexample TLC prints (counting the initial state). Same bounds as above.

| Variant (guard removed) | Property violated | States in trace | Shape of the counterexample |
| --- | --- | --- | --- |
| `G_WriteAhead` (fence written at completion, not before Stripe) | `AtMostOneTransfer` | 13 | run starts a transfer, fails before completing, its retry child starts another |
| `G_WriteAhead` | `FullOrNothing` | 9 | amount changes between begin and the Stripe call (assumption 2 stops this when the fence is written first) |
| `G_BeginFence` (`SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED`) | `AtMostOneTransfer` | 12 | same as above |
| `G_BeginFence` | `FullOrNothing` | 13 | same as above: two transfers sum to twice the amount |
| `G_BeginOp` (`SHIPMENT_CANCELLATION_OPERATION_ACTIVE`) | `NoTransferAfterCancel` | 9 | cancellation refund started, then a transfer begins |
| `G_BeginOp` + start-side guards (`G_StartFence`, `G_StartStatus`, `G_StartFunds`) | `NoTransferAfterCancel` | 9 | same |
| `G_BeginAmount` (mapping amount sent without comparing to the view) | `FullOrNothing` | 9 | amount changes after the run was created, a stale amount is sent |
| `G_CancelRefund` (`REFUND_NOT_SUCCEEDED`) | `RefundBeforeCancel` | 8 | shipment cancelled right after the refund started |

Single guards that are not the only barrier. Removing each of these alone, or all together, leaves all four properties passing (995,560 distinct states, same as the faithful model), because another guard or the status rules already exclude the bad interleaving: `G_ClaimFence`, `G_StartFence`, `G_StartStatus`, `G_StartFunds`, and `G_ClaimFence`+`G_StartFence`+`G_StartStatus`+`G_StartFunds` together. They are defense in depth inside this model's assumptions; do not read this as permission to delete them.
