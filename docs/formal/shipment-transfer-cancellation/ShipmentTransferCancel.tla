------------------------- MODULE ShipmentTransferCancel -------------------------
(***************************************************************************)
(* Shipment transfer (release) vs shipment cancellation coordination, and  *)
(* the admin refund of an overdue held payout (#549).                      *)
(* Sync commit: origin/main adb63322ed13f82b23d1172d4f8c4391b4616cbb;       *)
(* overdue refund: e3981880c2aa81f142245c24cfeec77948a1e11d.               *)
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
    G_BeginAmount,    \* begin: mapping net_payout_cents = release_amount_cents, send the view amount
    G_WriteAhead,     \* begin writes transfer_started_at before Stripe is called
    G_ClaimFence,     \* claim: SHIPMENT_TRANSFER_OPERATION_ACTIVE
    G_StartFence,     \* start: SHIPMENT_TRANSFER_OPERATION_ACTIVE
    G_StartStatus,    \* start: SHIPMENT_NOT_CANCELABLE
    G_StartFunds,     \* start: SHIPMENT_FUNDS_ALREADY_RELEASED
    G_CancelRefund,   \* fn_cancel_shipment: REFUND_NOT_SUCCEEDED
    G_ProgressOp,     \* tracking / fn_mark_shipment_delivered: no status change once external_started_at is set
    G_ConfirmOp,      \* fn_confirm_shipment_delivery: SHIPMENT_CANCELLATION_OPERATION_ACTIVE
    G_OverdueFunds,   \* overdue claim: SHIPMENT_FUNDS_ALREADY_RELEASED
    G_OverdueFence,   \* overdue claim: SHIPMENT_TRANSFER_OPERATION_ACTIVE (transfer_started_at)
    G_OverdueRunParked, \* overdue claim: PAYOUT_RUN_NOT_PARKED
    G_OverdueRefund   \* fn_complete_overdue_payout_refund: REFUND_NOT_SUCCEEDED

Runs == {Root, Child}
Amt == 2      \* release_amount_cents of a shipment (abstract units)
AltAmt == 1   \* the amount after one change of the view's inputs

VARIABLES
    shStatus,     \* shipments.status: paid | delivered | completed | cancelled | refunded
    transferId,   \* shipments.stripe_transfer_id: NONE or the run whose transfer was recorded
    viewAmt,      \* admin_connect_payout_release_view.release_amount_cents
    fence,        \* runs whose mapping has transfer_started_at set, per shipment
    sentAmt,      \* amount of the Stripe transfer created for (shipment, run key), 0 = none
    runState,     \* connect_payout_runs: none | pending | parked | failed | canceled
    runReason,    \* connect_payout_runs.action_required_reason: none | account | overdue
    mapNet,       \* connect_payout_run_shipments.net_payout_cents
    mapStatus,    \* connect_payout_run_shipments.status: none | pending | failed | canceled
    wpc,          \* release worker progress per (run, shipment): idle | begun | sent | done
    beginAmt,     \* amount returned by fn_begin_shipment_transfer
    op,           \* shipment_cancellation_operations: none | claimed | started
    opSrc,        \* shipment_cancellation_operations.source: none | cancel | overdue
    opGen,        \* claim_token generation
    opExpired,    \* claim_expires_at <= clock_timestamp()
    actorTok,     \* claim_token generation each actor holds (0 = none)
    refundAtStripe, \* a Stripe refund exists for the operation
    refundStatus, \* refund_status: none | succeeded | failed
    refundOk,     \* history: refund_status was recorded as succeeded at some point
    repaid        \* history: an admin recorded a manual repayment of a failed overdue refund (T2b)

vars == <<shStatus, transferId, viewAmt, fence, sentAmt, runState, runReason,
          mapNet, mapStatus, wpc, beginAmt, op, opSrc, opGen, opExpired,
          actorTok, refundAtStripe, refundStatus, refundOk, repaid>>

\* Variables the overdue refund added; the older actions leave them alone
\* unless they say otherwise.
overdueVars == <<runReason, opSrc, refundOk, repaid>>

Total(s) == sentAmt[s][Root] + sentAmt[s][Child]
HasChild(r) == r = Root /\ runState[Child] # "none"
OpActive(s) == op[s] = "started" \/ (op[s] = "claimed" /\ ~opExpired[s])

TypeOK ==
    /\ shStatus \in [Shipments -> {"paid", "delivered", "completed", "cancelled", "refunded"}]
    /\ transferId \in [Shipments -> Runs \cup {NONE}]
    /\ viewAmt \in [Shipments -> {Amt, AltAmt}]
    /\ fence \in [Shipments -> SUBSET Runs]
    /\ sentAmt \in [Shipments -> [Runs -> {0, Amt, AltAmt}]]
    /\ runState \in [Runs -> {"none", "pending", "parked", "failed", "canceled"}]
    /\ runReason \in [Runs -> {"none", "account", "overdue"}]
    /\ mapStatus \in [Runs -> [Shipments -> {"none", "pending", "failed", "canceled"}]]
    /\ wpc \in [Runs -> [Shipments -> {"idle", "begun", "sent", "done"}]]
    /\ op \in [Shipments -> {"none", "claimed", "started"}]
    /\ opSrc \in [Shipments -> {"none", "cancel", "overdue"}]
    /\ refundStatus \in [Shipments -> {"none", "succeeded", "failed"}]
    /\ refundOk \in [Shipments -> BOOLEAN]
    /\ repaid \in [Shipments -> BOOLEAN]

Init ==
    /\ shStatus = [s \in Shipments |-> "paid"]
    /\ transferId = [s \in Shipments |-> NONE]
    /\ viewAmt = [s \in Shipments |-> Amt]
    /\ fence = [s \in Shipments |-> {}]
    /\ sentAmt = [s \in Shipments |-> [r \in Runs |-> 0]]
    /\ runState = [r \in Runs |-> "none"]
    /\ runReason = [r \in Runs |-> "none"]
    /\ mapNet = [r \in Runs |-> [s \in Shipments |-> 0]]
    /\ mapStatus = [r \in Runs |-> [s \in Shipments |-> "none"]]
    /\ wpc = [r \in Runs |-> [s \in Shipments |-> "idle"]]
    /\ beginAmt = [r \in Runs |-> [s \in Shipments |-> 0]]
    /\ op = [s \in Shipments |-> "none"]
    /\ opSrc = [s \in Shipments |-> "none"]
    /\ opGen = [s \in Shipments |-> 0]
    /\ opExpired = [s \in Shipments |-> FALSE]
    /\ actorTok = [a \in Actors |-> [s \in Shipments |-> 0]]
    /\ refundAtStripe = [s \in Shipments |-> FALSE]
    /\ refundStatus = [s \in Shipments |-> "none"]
    /\ refundOk = [s \in Shipments |-> FALSE]
    /\ repaid = [s \in Shipments |-> FALSE]

(***************************** shipment lifecycle ****************************)

\* Label, carrier and delivery steps up to shipments.status = 'delivered':
\* fn_record_tracking_event (shipped, delivered) and fn_mark_shipment_delivered.
\* Once external_started_at is set they leave the status alone (B5.8).
Progress(s) ==
    /\ shStatus[s] = "paid"
    /\ G_ProgressOp => op[s] # "started"
    /\ shStatus' = [shStatus EXCEPT ![s] = "delivered"]
    /\ UNCHANGED <<transferId, viewAmt, fence, sentAmt, runState, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>
    /\ UNCHANGED overdueVars

\* fn_confirm_shipment_delivery: delivered -> completed.
ConfirmDelivery(s) ==
    /\ shStatus[s] = "delivered"
    /\ G_ConfirmOp => op[s] # "started"           \* SHIPMENT_CANCELLATION_OPERATION_ACTIVE
    /\ shStatus' = [shStatus EXCEPT ![s] = "completed"]
    /\ UNCHANGED <<transferId, viewAmt, fence, sentAmt, runState, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>
    /\ UNCHANGED overdueVars

\* Inputs of the release view change (order_items.net_payout_cents, shipments.shipping_cost_cents).
\* Assumption: only before any transfer fence or Stripe transfer exists.
Reprice(s) ==
    /\ viewAmt[s] = Amt
    /\ fence[s] = {}
    /\ Total(s) = 0
    /\ viewAmt' = [viewAmt EXCEPT ![s] = AltAmt]
    /\ UNCHANGED <<shStatus, transferId, fence, sentAmt, runState, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>
    /\ UNCHANGED overdueVars

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
    /\ UNCHANGED overdueVars

\* A pending run fails (payout failure or reconciliation outcome). The
\* transfer_started_at fence is never cleared by this (column comment).
\* Only open mappings fail; a mapping the overdue refund closed stays canceled.
FailRun(r) ==
    /\ runState[r] = "pending"
    /\ runState' = [runState EXCEPT ![r] = "failed"]
    /\ mapStatus' = [mapStatus EXCEPT ![r] =
                        [s \in Shipments |-> IF mapStatus[r][s] = "pending"
                                             THEN "failed" ELSE mapStatus[r][s]]]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, mapNet, wpc,
                   beginAmt, op, opGen, opExpired, actorTok, refundAtStripe,
                   refundStatus>>
    /\ UNCHANGED overdueVars

\* fn_block_payout_run_for_account_actionability or fn_commit_connect_account_refresh
\* (account not actionable): release_stage = 'action_required',
\* action_required_reason = 'account_not_actionable'. Allowed at any moment.
ParkRun(r) ==
    /\ runState[r] = "pending"
    /\ runState' = [runState EXCEPT ![r] = "parked"]
    /\ runReason' = [runReason EXCEPT ![r] = "account"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus, opSrc, refundOk, repaid>>

\* fn_commit_connect_account_refresh (account actionable again): resumes only a
\* run parked with action_required_reason = 'account_not_actionable'.
ResumeRun(r) ==
    /\ runState[r] = "parked"
    /\ runReason[r] = "account"
    /\ runState' = [runState EXCEPT ![r] = "pending"]
    /\ runReason' = [runReason EXCEPT ![r] = "none"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus, opSrc, refundOk, repaid>>

(****************************** release worker ********************************)

\* fn_begin_shipment_transfer (shipment_transfer_coordination.sql).
Begin(r, s) ==
    /\ wpc[r][s] = "idle"
    \* run lock: status pending_reconciliation, not parked, no retry child
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
    /\ UNCHANGED overdueVars

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
    /\ UNCHANGED overdueVars

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
    /\ UNCHANGED overdueVars

\* Process crash / lost response: the token is lost, the worker may start over
\* from fn_begin_shipment_transfer. No database state changes.
WorkerCrash(r, s) ==
    /\ wpc[r][s] \in {"begun", "sent"}
    /\ wpc' = [wpc EXCEPT ![r][s] = "idle"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>
    /\ UNCHANGED overdueVars

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
    /\ opSrc' = [opSrc EXCEPT ![s] = "cancel"]
    /\ opGen' = [opGen EXCEPT ![s] = @ + 1]
    /\ opExpired' = [opExpired EXCEPT ![s] = FALSE]
    /\ actorTok' = [actorTok EXCEPT ![a][s] = opGen[s] + 1]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, refundAtStripe, refundStatus>>
    /\ UNCHANGED <<runReason, refundOk, repaid>>

\* claim_expires_at passes.
ExpireClaim(s) ==
    /\ op[s] = "claimed"
    /\ ~opExpired[s]
    /\ opExpired' = [opExpired EXCEPT ![s] = TRUE]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, op, opGen, actorTok,
                   refundAtStripe, refundStatus>>
    /\ UNCHANGED overdueVars

\* fn_start_shipment_cancellation_refund (wraps fn_start_shipment_cancellation):
\* sets external_started_at. Never cleared afterwards. The status it requires
\* depends on the operation's source: paid for a cancellation, completed for
\* the overdue payout refund.
StartRefund(a, s) ==
    /\ op[s] = "claimed"
    /\ actorTok[a][s] = opGen[s]                       \* STALE_CANCELLATION_CLAIM
    /\ ~opExpired[s]                                   \* CANCELLATION_CLAIM_EXPIRED
    /\ G_StartStatus => shStatus[s] =                  \* SHIPMENT_NOT_CANCELABLE
                          (IF opSrc[s] = "overdue" THEN "completed" ELSE "paid")
    /\ G_StartFunds => transferId[s] = NONE            \* SHIPMENT_FUNDS_ALREADY_RELEASED
    /\ G_StartFence => fence[s] = {}                   \* SHIPMENT_TRANSFER_OPERATION_ACTIVE
    /\ op' = [op EXCEPT ![s] = "started"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>
    /\ UNCHANGED overdueVars

\* cancel-order stripe.refunds.create with the frozen request. Idempotent and
\* retried by any caller after a crash (recovery reuses the recorded request).
StripeRefund(s) ==
    /\ op[s] = "started"
    /\ refundAtStripe' = [refundAtStripe EXCEPT ![s] = TRUE]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, op, opGen, opExpired,
                   actorTok, refundStatus>>
    /\ UNCHANGED overdueVars

\* fn_record_shipment_cancellation_refund with status 'succeeded'. A failed
\* refund never becomes succeeded again, and a resolved operation is never written.
RecordRefund(s) ==
    /\ op[s] = "started"
    /\ refundAtStripe[s]
    /\ refundStatus[s] # "failed"
    /\ ~repaid[s]
    /\ refundStatus' = [refundStatus EXCEPT ![s] = "succeeded"]
    /\ refundOk' = [refundOk EXCEPT ![s] = TRUE]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, op, opGen, opExpired,
                   actorTok, refundAtStripe>>
    /\ UNCHANGED <<runReason, opSrc, repaid>>

\* fn_cancel_shipment: status paid|preparing and a succeeded refund.
CancelShipment(s) ==
    /\ shStatus[s] = "paid"                            \* CANNOT_CANCEL_IN_THIS_STATUS
    /\ G_CancelRefund => refundStatus[s] = "succeeded" \* REFUND_NOT_SUCCEEDED
    /\ op[s] = "started"
    /\ shStatus' = [shStatus EXCEPT ![s] = "cancelled"]
    /\ UNCHANGED <<transferId, viewAmt, fence, sentAmt, runState, mapNet,
                   mapStatus, wpc, beginAmt, op, opGen, opExpired, actorTok,
                   refundAtStripe, refundStatus>>
    /\ UNCHANGED overdueVars

(************************* admin overdue payout refund ************************)

\* fn_claim_overdue_payout_refund. The admin is one of Actors. The overdue age
\* and the rejected seller are not modeled (assumption 9), which only allows more
\* claims. busy, recovery_required and refusals change nothing.
ClaimOverdue(a, s) ==
    /\ shStatus[s] = "completed"                       \* SHIPMENT_NOT_COMPLETED
    /\ G_OverdueFunds => transferId[s] = NONE          \* SHIPMENT_FUNDS_ALREADY_RELEASED
    /\ G_OverdueFence => fence[s] = {}                 \* SHIPMENT_TRANSFER_OPERATION_ACTIVE
    /\ G_OverdueRunParked =>                           \* PAYOUT_RUN_NOT_PARKED
         \A r \in Runs : mapStatus[r][s] = "pending" => runState[r] = "parked"
    \* a new operation, or re-owning an expired claim that never started
    \* (of any source; an active one raises SHIPMENT_CANCELLATION_OPERATION_ACTIVE)
    /\ \/ op[s] = "none"
       \/ (op[s] = "claimed" /\ opExpired[s])
    /\ opGen[s] < MaxGen
    /\ op' = [op EXCEPT ![s] = "claimed"]
    /\ opSrc' = [opSrc EXCEPT ![s] = "overdue"]
    /\ opGen' = [opGen EXCEPT ![s] = @ + 1]
    /\ opExpired' = [opExpired EXCEPT ![s] = FALSE]
    /\ actorTok' = [actorTok EXCEPT ![a][s] = opGen[s] + 1]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, refundAtStripe, refundStatus>>
    /\ UNCHANGED <<runReason, refundOk, repaid>>

\* fn_record_shipment_cancellation_refund with status 'failed' (or 'canceled'),
\* direct or through fn_apply_shipment_cancellation_refund_event. The code also
\* moves 'succeeded' to 'failed' (a card refund that fails later). Only the
\* overdue refund's failure is modeled (assumption 5).
RecordRefundFailed(s) ==
    /\ opSrc[s] = "overdue"
    /\ op[s] = "started"
    /\ refundAtStripe[s]
    /\ refundStatus[s] \in {"none", "succeeded"}
    /\ ~repaid[s]
    /\ refundStatus' = [refundStatus EXCEPT ![s] = "failed"]
    /\ UNCHANGED <<shStatus, transferId, viewAmt, fence, sentAmt, runState,
                   mapNet, mapStatus, wpc, beginAmt, op, opGen, opExpired,
                   actorTok, refundAtStripe>>
    /\ UNCHANGED overdueVars

\* completed -> refunded, and the payout runs that held the shipment: each
\* mapping that never started a transfer is canceled; its run is canceled when
\* nothing else is open, otherwise parked with reason overdue_payout_refunded
\* (which no account update resumes).
Closing(r, s) == mapStatus[r][s] = "pending" /\ r \notin fence[s]
OthersOpen(r, s) == \E s2 \in Shipments \ {s} : mapStatus[r][s2] = "pending"

RefundShipment(s) ==
    /\ shStatus' = [shStatus EXCEPT ![s] = "refunded"]
    /\ mapStatus' = [r \in Runs |->
                       IF Closing(r, s) THEN [mapStatus[r] EXCEPT ![s] = "canceled"]
                       ELSE mapStatus[r]]
    /\ runState' = [r \in Runs |->
                      IF Closing(r, s) /\ runState[r] \in {"pending", "parked"}
                      THEN (IF OthersOpen(r, s) THEN "parked" ELSE "canceled")
                      ELSE runState[r]]
    /\ runReason' = [r \in Runs |->
                       IF Closing(r, s) /\ runState[r] \in {"pending", "parked"}
                       THEN (IF OthersOpen(r, s) THEN "overdue" ELSE "none")
                       ELSE runReason[r]]

\* fn_complete_overdue_payout_refund (also called by
\* fn_apply_shipment_cancellation_refund_event on a succeeded refund event).
CompleteOverdue(s) ==
    /\ opSrc[s] = "overdue"                            \* OVERDUE_REFUND_NOT_STARTED
    /\ op[s] = "started"
    /\ G_OverdueRefund => refundStatus[s] = "succeeded" \* REFUND_NOT_SUCCEEDED
    /\ shStatus[s] = "completed"                       \* SHIPMENT_STATUS_UNEXPECTED
    /\ RefundShipment(s)
    /\ UNCHANGED <<transferId, viewAmt, fence, sentAmt, mapNet, wpc, beginAmt,
                   op, opGen, opExpired, actorTok, refundAtStripe, refundStatus>>
    /\ UNCHANGED <<opSrc, refundOk, repaid>>

\* T2b (pending, L11): after a FAILED overdue refund an admin records a manual
\* repayment, as fn_resolve_shipment_cancellation_refund does for a failed
\* cancellation refund, and the shipment moves completed -> refunded. Modeled
\* with the same run and mapping closing as CompleteOverdue.
ResolveFailedOverdueRefund(s) ==
    /\ opSrc[s] = "overdue"
    /\ op[s] = "started"
    /\ refundStatus[s] = "failed"
    /\ ~repaid[s]
    /\ shStatus[s] = "completed"
    /\ repaid' = [repaid EXCEPT ![s] = TRUE]
    /\ RefundShipment(s)
    /\ UNCHANGED <<transferId, viewAmt, fence, sentAmt, mapNet, wpc, beginAmt,
                   op, opGen, opExpired, actorTok, refundAtStripe, refundStatus>>
    /\ UNCHANGED <<opSrc, refundOk>>

Next ==
    \/ \E s \in Shipments :
         Progress(s) \/ ConfirmDelivery(s) \/ Reprice(s) \/ ExpireClaim(s)
         \/ StripeRefund(s) \/ RecordRefund(s) \/ CancelShipment(s)
         \/ RecordRefundFailed(s) \/ CompleteOverdue(s)
         \/ ResolveFailedOverdueRefund(s)
    \/ \E r \in Runs : CreateRun(r) \/ FailRun(r) \/ ParkRun(r) \/ ResumeRun(r)
    \/ \E r \in Runs, s \in Shipments :
         Begin(r, s) \/ StripeTransfer(r, s) \/ CompleteTransfer(r, s)
         \/ WorkerCrash(r, s)
    \/ \E a \in Actors, s \in Shipments :
         ClaimCancel(a, s) \/ StartRefund(a, s) \/ ClaimOverdue(a, s)

Spec == Init /\ [][Next]_vars

(******************************** properties **********************************)

\* Harm: the seller is paid part of what they are owed, or paid twice.
FullOrNothing ==
    \A s \in Shipments : Total(s) = 0 \/ Total(s) = viewAmt[s]

\* Harm: the buyer is refunded and the seller is also paid (or the reverse).
\* Holds for every operation source, the overdue refund included.
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

\* Harm: a shipment whose refund started is advanced, so its refund can never
\* finish: the buyer is refunded and the shipment is wedged. A cancellation keeps
\* the shipment paid/preparing until cancelled; the overdue refund keeps it
\* completed until refunded.
RefundStartedStaysOpen ==
    \A s \in Shipments :
        op[s] = "started" =>
            shStatus[s] \in (IF opSrc[s] = "overdue"
                             THEN {"completed", "refunded"}
                             ELSE {"paid", "cancelled"})

\* The same as a step property: after external_started_at is set, a paid/preparing
\* shipment only ever moves to cancelled.
RefundStartedOnlyCancels ==
    [][\A s \in Shipments :
          (op[s] = "started" /\ shStatus[s] = "paid")
              => shStatus'[s] \in {"paid", "cancelled"}]_vars

\* Harm: the buyer gets the money back and the seller is paid too (money sent twice).
NeverRefundedAndTransferred ==
    \A s \in Shipments :
        (shStatus[s] = "refunded" \/ refundAtStripe[s] \/ repaid[s])
            => (Total(s) = 0 /\ transferId[s] = NONE)

\* Harm: a transfer starts after the overdue refund was handed to Stripe.
\* fence is never cleared, so this state invariant also rules out a transfer
\* that started before the refund.
NoTransferAfterOverdueStart ==
    \A s \in Shipments :
        (opSrc[s] = "overdue" /\ op[s] = "started")
            => (fence[s] = {} /\ Total(s) = 0 /\ transferId[s] = NONE)

\* Harm: the shipment is recorded as refunded while the buyer got nothing.
\* Refunded only through the overdue refund, after a succeeded Stripe refund or
\* a manual repayment recorded after a failed one (T2b).
RefundedHadRefund ==
    \A s \in Shipments :
        /\ shStatus[s] = "refunded"
             => (opSrc[s] = "overdue" /\ op[s] = "started"
                 /\ (refundOk[s] \/ repaid[s]))
        /\ repaid[s] => refundStatus[s] = "failed"

\* Step property: an overdue refund that started only ever moves its completed
\* shipment to refunded.
OverdueStartedOnlyRefunds ==
    [][\A s \in Shipments :
          (op[s] = "started" /\ opSrc[s] = "overdue" /\ shStatus[s] = "completed")
              => shStatus'[s] \in {"completed", "refunded"}]_vars

=============================================================================
