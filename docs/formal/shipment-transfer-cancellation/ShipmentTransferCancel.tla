------------------------- MODULE ShipmentTransferCancel -------------------------
(***************************************************************************)
(* Shipment transfer (release) vs shipment cancellation coordination.      *)
(* Sync commit: origin/main adb63322ed13f82b23d1172d4f8c4391b4616cbb       *)
(* Each action maps to a named code step; see README.md for the table.     *)
(* Disputes and returns are out of scope for this model.                   *)
(*                                                                         *)
(* The G_* constants switch one guard each. All TRUE is the faithful model;*)
(* README.md lists the variants produced by turning guards off.            *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    Shipments,   \* shipments.id values
    Actors,      \* cancellation callers: buyer / cron / admin
    Root, Child, \* connect_payout_runs: a run and its one retry child
    NONE,        \* NULL
    MaxGen,      \* bound on claim_token rotations per shipment
    G_BeginOp,        \* begin: SHIPMENT_CANCELLATION_OPERATION_ACTIVE
    G_BeginFence,     \* begin: SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED
    G_BeginAmount,    \* begin: mapping net_payout = release_amount_cents, send the view amount
    G_WriteAhead,     \* begin writes transfer_started_at before Stripe is called
    G_ClaimFence,     \* claim: SHIPMENT_TRANSFER_OPERATION_ACTIVE
    G_StartFence,     \* start: SHIPMENT_TRANSFER_OPERATION_ACTIVE
    G_StartStatus,    \* start: SHIPMENT_NOT_CANCELABLE
    G_StartFunds,     \* start: SHIPMENT_FUNDS_ALREADY_RELEASED
    G_CancelRefund    \* fn_cancel_shipment: REFUND_NOT_SUCCEEDED

Runs == {Root, Child}
Amt == 2      \* release_amount_cents of a shipment (abstract units)
AltAmt == 1   \* the amount after one change of the view's inputs

VARIABLES
    shStatus,     \* shipments.status: paid | delivered | completed | cancelled
    transferId,   \* shipments.stripe_transfer_id: NONE or the run whose transfer was recorded
    viewAmt,      \* admin_connect_payout_release_view.release_amount_cents
    fence,        \* runs whose mapping has transfer_started_at set, per shipment
    sentAmt,      \* amount of the Stripe transfer created for (shipment, run key), 0 = none
    runState,     \* connect_payout_runs.status: none | pending | failed
    mapNet,       \* connect_payout_run_shipments.net_payout
    mapStatus,    \* connect_payout_run_shipments.status: none | pending | failed
    wpc,          \* release worker progress per (run, shipment): idle | begun | sent | done
    beginAmt,     \* amount returned by fn_begin_shipment_transfer
    op,           \* shipment_cancellation_operations: none | claimed | started
    opGen,        \* claim_token generation
    opExpired,    \* claim_expires_at <= clock_timestamp()
    actorTok,     \* claim_token generation each actor holds (0 = none)
    refundAtStripe, \* a Stripe refund exists for the operation
    refundStatus  \* refund_status: none | succeeded

vars == <<shStatus, transferId, viewAmt, fence, sentAmt, runState, mapNet,
          mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
          refundAtStripe, refundStatus>>

Total(s) == sentAmt[s][Root] + sentAmt[s][Child]
HasChild(r) == r = Root /\ runState[Child] # "none"
OpActive(s) == op[s] = "started" \/ (op[s] = "claimed" /\ ~opExpired[s])

TypeOK ==
    /\ shStatus \in [Shipments -> {"paid", "delivered", "completed", "cancelled"}]
    /\ transferId \in [Shipments -> Runs \cup {NONE}]
    /\ viewAmt \in [Shipments -> {Amt, AltAmt}]
    /\ fence \in [Shipments -> SUBSET Runs]
    /\ sentAmt \in [Shipments -> [Runs -> {0, Amt, AltAmt}]]
    /\ runState \in [Runs -> {"none", "pending", "failed"}]
    /\ mapStatus \in [Runs -> [Shipments -> {"none", "pending", "failed"}]]
    /\ wpc \in [Runs -> [Shipments -> {"idle", "begun", "sent", "done"}]]
    /\ op \in [Shipments -> {"none", "claimed", "started"}]
    /\ refundStatus \in [Shipments -> {"none", "succeeded"}]

Init ==
    /\ shStatus = [s \in Shipments |-> "paid"]
    /\ transferId = [s \in Shipments |-> NONE]
    /\ viewAmt = [s \in Shipments |-> Amt]
    /\ fence = [s \in Shipments |-> {}]
    /\ sentAmt = [s \in Shipments |-> [r \in Runs |-> 0]]
    /\ runState = [r \in Runs |-> "none"]
    /\ mapNet = [r \in Runs |-> [s \in Shipments |-> 0]]
    /\ mapStatus = [r \in Runs |-> [s \in Shipments |-> "none"]]
    /\ wpc = [r \in Runs |-> [s \in Shipments |-> "idle"]]
    /\ beginAmt = [r \in Runs |-> [s \in Shipments |-> 0]]
    /\ op = [s \in Shipments |-> "none"]
    /\ opGen = [s \in Shipments |-> 0]
    /\ opExpired = [s \in Shipments |-> FALSE]
    /\ actorTok = [a \in Actors |-> [s \in Shipments |-> 0]]
    /\ refundAtStripe = [s \in Shipments |-> FALSE]
    /\ refundStatus = [s \in Shipments |-> "none"]

(***************************** shipment lifecycle ****************************)

\* Label, carrier and delivery steps up to shipments.status = 'delivered'.
\* Deliberately NOT gated by the cancellation operation (conservative).
Progress(s) ==
    /\ shStatus[s] = "paid"
    /\ shStatus' = [shStatus EXCEPT ![s] = "delivered"]
    /\ UNCHANGED <<transferId, viewAmt, fence, sentAmt, runState, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>

\* fn_confirm_shipment_delivery: delivered -> completed.
ConfirmDelivery(s) ==
    /\ shStatus[s] = "delivered"
    /\ shStatus' = [shStatus EXCEPT ![s] = "completed"]
    /\ UNCHANGED <<transferId, viewAmt, fence, sentAmt, runState, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>

\* Inputs of the release view change (order_items.net_payout, shipping_cost).
\* Assumption: only before any transfer fence or Stripe transfer exists.
Reprice(s) ==
    /\ viewAmt[s] = Amt
    /\ fence[s] = {}
    /\ Total(s) = 0
    /\ viewAmt' = [viewAmt EXCEPT ![s] = AltAmt]
    /\ UNCHANGED <<shStatus, transferId, fence, sentAmt, runState, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>

(**************************** payout run and mapping **************************)

\* releaseConnectPayout: deps.createRun + deps.createRunShipments. The root run
\* is the first request; the child is the one retry child of a failed run.
\* Assertions: assertEligibleRows (all completed), active-once mapping index.
CreateRun(r) ==
    /\ runState[r] = "none"
    /\ (r = Root \/ runState[Root] = "failed")
    /\ \A s \in Shipments : shStatus[s] = "completed"
    /\ \A r2 \in Runs, s \in Shipments : mapStatus[r2][s] # "pending"
    /\ runState' = [runState EXCEPT ![r] = "pending"]
    /\ mapNet' = [mapNet EXCEPT ![r] = viewAmt]
    /\ mapStatus' = [mapStatus EXCEPT ![r] = [s \in Shipments |-> "pending"]]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, wpc, beginAmt,
                   op, opGen, opExpired, actorTok, refundAtStripe, refundStatus>>

\* A pending run fails (payout failure or reconciliation outcome). The
\* transfer_started_at fence is never cleared by this (column comment).
FailRun(r) ==
    /\ runState[r] = "pending"
    /\ runState' = [runState EXCEPT ![r] = "failed"]
    /\ mapStatus' = [mapStatus EXCEPT ![r] = [s \in Shipments |-> "failed"]]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, mapNet, wpc,
                   beginAmt, op, opGen, opExpired, actorTok, refundAtStripe,
                   refundStatus>>

(****************************** release worker ********************************)

\* fn_begin_shipment_transfer (shipment_transfer_coordination.sql).
Begin(r, s) ==
    /\ wpc[r][s] = "idle"
    \* run lock: status pending_reconciliation, no retry child
    /\ runState[r] = "pending"
    /\ ~HasChild(r)
    \* mapping lock: status pending_reconciliation
    /\ mapStatus[r][s] = "pending"
    \* shipment lock, then in source order:
    /\ G_BeginOp => ~OpActive(s)                      \* SHIPMENT_CANCELLATION_OPERATION_ACTIVE
    /\ transferId[s] = NONE                            \* SHIPMENT_FUNDS_ALREADY_RELEASED
    /\ G_BeginFence => fence[s] = {}                   \* SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED
    /\ shStatus[s] = "completed"                       \* SHIPMENT_NOT_COMPLETED
    /\ G_BeginAmount => mapNet[r][s] = viewAmt[s]      \* SHIPMENT_TRANSFER_INELIGIBLE
    /\ \A r2 \in Runs \ {r} : mapStatus[r2][s] # "pending"  \* SHIPMENT_TRANSFER_INELIGIBLE
    /\ fence' = IF G_WriteAhead
                THEN [fence EXCEPT ![s] = @ \cup {r}]  \* UPDATE ... transfer_started_at
                ELSE fence
    /\ beginAmt' = [beginAmt EXCEPT ![r][s] =
                        IF G_BeginAmount THEN viewAmt[s] ELSE mapNet[r][s]]
    /\ wpc' = [wpc EXCEPT ![r][s] = "begun"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, sentAmt, runState, mapNet,
                   mapStatus, op, opGen, opExpired, actorTok, refundAtStripe,
                   refundStatus>>

\* createStripeTransfer (index.ts, stripe.transfers.create). The idempotency key
\* is run.idempotency_key:run_id:shipment_id, so a replay for the same run
\* returns the same transfer and a different run creates another one.
StripeTransfer(r, s) ==
    /\ wpc[r][s] \in {"begun", "sent"}
    /\ sentAmt' = IF sentAmt[s][r] = 0
                  THEN [sentAmt EXCEPT ![s][r] = beginAmt[r][s]]
                  ELSE sentAmt
    /\ wpc' = [wpc EXCEPT ![r][s] = "sent"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, runState, mapNet,
                   mapStatus, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>

\* fn_complete_shipment_transfer: returns false (no change) when the run, the
\* mapping or the token no longer match; records stripe_transfer_id.
CompleteTransfer(r, s) ==
    /\ wpc[r][s] = "sent"
    /\ runState[r] = "pending"
    /\ ~HasChild(r)
    /\ mapStatus[r][s] = "pending"
    /\ transferId[s] = NONE
    /\ transferId' = [transferId EXCEPT ![s] = r]
    /\ fence' = IF G_WriteAhead THEN fence
                ELSE [fence EXCEPT ![s] = @ \cup {r}]
    /\ wpc' = [wpc EXCEPT ![r][s] = "done"]
    /\ UNCHANGED <<shStatus, viewAmt, sentAmt, runState, mapNet, mapStatus,
                   beginAmt, op, opGen, opExpired, actorTok, refundAtStripe,
                   refundStatus>>

\* Process crash / lost response: the token is lost, the worker may start over
\* from fn_begin_shipment_transfer. No database state changes.
WorkerCrash(r, s) ==
    /\ wpc[r][s] \in {"begun", "sent"}
    /\ wpc' = [wpc EXCEPT ![r][s] = "idle"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>

(**************************** cancellation actor ******************************)

\* fn_claim_shipment_cancellation. A busy or recovery_required answer changes
\* nothing, so only the claimed outcomes are actions.
ClaimCancel(a, s) ==
    /\ shStatus[s] = "paid"                            \* SHIPMENT_NOT_CANCELABLE
    /\ transferId[s] = NONE                            \* SHIPMENT_FUNDS_ALREADY_RELEASED
    /\ G_ClaimFence => fence[s] = {}                   \* SHIPMENT_TRANSFER_OPERATION_ACTIVE
    /\ \/ op[s] = "none"
       \/ (op[s] = "claimed" /\ opExpired[s])          \* token rotation on an expired claim
    /\ opGen[s] < MaxGen
    /\ op' = [op EXCEPT ![s] = "claimed"]
    /\ opGen' = [opGen EXCEPT ![s] = @ + 1]
    /\ opExpired' = [opExpired EXCEPT ![s] = FALSE]
    /\ actorTok' = [actorTok EXCEPT ![a][s] = opGen[s] + 1]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, refundAtStripe, refundStatus>>

\* claim_expires_at passes.
ExpireClaim(s) ==
    /\ op[s] = "claimed"
    /\ ~opExpired[s]
    /\ opExpired' = [opExpired EXCEPT ![s] = TRUE]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, op, opGen, actorTok,
                   refundAtStripe, refundStatus>>

\* fn_start_shipment_cancellation_refund (wraps fn_start_shipment_cancellation):
\* sets external_started_at. Never cleared afterwards.
StartRefund(a, s) ==
    /\ op[s] = "claimed"
    /\ actorTok[a][s] = opGen[s]                       \* STALE_CANCELLATION_CLAIM
    /\ ~opExpired[s]                                   \* CANCELLATION_CLAIM_EXPIRED
    /\ G_StartStatus => shStatus[s] = "paid"           \* SHIPMENT_NOT_CANCELABLE
    /\ G_StartFunds => transferId[s] = NONE            \* SHIPMENT_FUNDS_ALREADY_RELEASED
    /\ G_StartFence => fence[s] = {}                   \* SHIPMENT_TRANSFER_OPERATION_ACTIVE
    /\ op' = [op EXCEPT ![s] = "started"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>

\* cancel-order stripe.refunds.create with the frozen request. Idempotent and
\* retried by any caller after a crash (recovery reuses the recorded request).
StripeRefund(s) ==
    /\ op[s] = "started"
    /\ refundAtStripe' = [refundAtStripe EXCEPT ![s] = TRUE]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, op, opGen, opExpired,
                   actorTok, refundStatus>>

\* fn_record_shipment_cancellation_refund with status 'succeeded'.
RecordRefund(s) ==
    /\ op[s] = "started"
    /\ refundAtStripe[s]
    /\ refundStatus' = [refundStatus EXCEPT ![s] = "succeeded"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, op, opGen, opExpired,
                   actorTok, refundAtStripe>>

\* fn_cancel_shipment: status paid|preparing and a succeeded refund.
CancelShipment(s) ==
    /\ shStatus[s] = "paid"                            \* CANNOT_CANCEL_IN_THIS_STATUS
    /\ G_CancelRefund => refundStatus[s] = "succeeded" \* REFUND_NOT_SUCCEEDED
    /\ op[s] = "started"
    /\ shStatus' = [shStatus EXCEPT ![s] = "cancelled"]
    /\ UNCHANGED <<transferId, viewAmt, fence, sentAmt, runState, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>

Next ==
    \/ \E s \in Shipments :
         Progress(s) \/ ConfirmDelivery(s) \/ Reprice(s) \/ ExpireClaim(s)
         \/ StripeRefund(s) \/ RecordRefund(s) \/ CancelShipment(s)
    \/ \E r \in Runs : CreateRun(r) \/ FailRun(r)
    \/ \E r \in Runs, s \in Shipments :
         Begin(r, s) \/ StripeTransfer(r, s) \/ CompleteTransfer(r, s)
         \/ WorkerCrash(r, s)
    \/ \E a \in Actors, s \in Shipments : ClaimCancel(a, s) \/ StartRefund(a, s)

Spec == Init /\ [][Next]_vars

(******************************** properties **********************************)

\* Harm: the seller is paid part of what they are owed, or paid twice.
FullOrNothing ==
    \A s \in Shipments : Total(s) = 0 \/ Total(s) = viewAmt[s]

\* Harm: the buyer is refunded and the seller is also paid (or the reverse).
NoTransferAfterCancel ==
    \A s \in Shipments :
        (fence[s] # {} \/ Total(s) > 0 \/ transferId[s] # NONE)
            => (shStatus[s] # "cancelled" /\ op[s] # "started"
                /\ ~refundAtStripe[s])

\* Harm: Selene pays out the same shipment through two Stripe transfers.
AtMostOneTransfer ==
    \A s \in Shipments :
        Cardinality({r \in Runs : sentAmt[s][r] > 0}) <= 1

\* Harm: the shipment is cancelled while the buyer has not been refunded.
RefundBeforeCancel ==
    \A s \in Shipments : shStatus[s] = "cancelled" => refundStatus[s] = "succeeded"

=============================================================================
