# Shipment lifecycle model-based tests

Item 4 of roadmap #623 (closes #628): fast-check model-based tests that run random sequences of shipment and payout operations against the local database and check the money invariants after every step.
Branch `test/shipment-lifecycle-model` from `origin/main` (`392908b4`), worktree `C:/dev/School-portal-worktrees/lifecycle-model`. Engram mirror: `odd/shipment-lifecycle-model-tests/tasks`. Scope decided in the 2026-11-16 session (L2-L4).

## Specs

- **S1 — Random sequences against the local database.** From #628: "generate random sequences of operations (pay, cancel, refund success and failure, duplicate and out-of-order webhook, payout release, overdue refund) and check invariants after each step against a small model, such as "a refunded shipment never gets a payout" and "a payout releases the full shipment amount or nothing"." Stripe is faked; the commands call the SQL RPCs directly (L3). The model stays minimal (what the preconditions need); invariants are checked on the database rows and named after the TLA+ invariants in `docs/formal/shipment-transfer-cancellation/` (L3).
- **S2 — First lifecycle, then overdue.** Payment, cancellation, refund (succeeded, failed, duplicate and out-of-order events) and transfer first; the overdue refund in a second commit of this item (L3).
- **S3 — Fixed budget, PR and weekly.** "Start with one lifecycle and a fixed run budget; decide in the item whether it runs per pull request or weekly." Decided: a bounded run in the `pr` harness group, measured to stay well under the CI budget, and a longer run in the weekly job (L3).
- **S4 — Reproducible failures.** A failure prints the fast-check seed and path, and the harness help says how to replay them (L3).
- **S5 — Not a goal.** Concurrency (TLC and the coordination harnesses cover races), the Edge Function orchestration (its port tests cover it), disputes and returns, and migrating the existing harnesses to a shared helper (an Idea issue) (L3).

## Tasks

- [x] T1 — S1, S2, S4. Harness `scripts/verify/test-shipment-lifecycle-model.ts`: commands for payment, cancellation claim and start, refund recorded (succeeded, failed), async refund events (duplicate, out of order), delivery and completion, payout run release (begin and complete transfer); invariants after each step; a RED proof that a broken guard is caught (mutants M1 and M2, L5). Added to the `pr` group. Inline. Commit: pending.
- [ ] T2 — S2. Overdue refund commands (claim, complete, failed refund, manual repayment) and their invariants. Inline. Commit: pending.
- [ ] T3 — S3. Longer weekly run (run budget from an environment variable set by the weekly workflow). CI change approved in L3-L4. Inline. Commit: pending.
- [ ] T4 — S1, S5. Formal README mapping (TLA+ invariant to harness check), `docs/` mention, Idea issue for the shared harness helper. Inline. Commit: pending.

## Log

- **L1** — User request, 2026-11-16:

  > arranquemos #628 del roadmap #623, dime que opinas del issue, y opina en general , no lo tomes como un facto lo que dice ahi si no como una guia.

- **L2** — Agent opinion, 2026-11-16: the command list is the specification (take it from the TLA+ `Next` actions and Stripe event orders); concurrency is out of scope; keep the TypeScript model minimal and check invariants on the rows; SQL level first; measure the budget; extract a shared helper only for the new harness.
- **L3** — Maintainer, 2026-11-16, after the agent clarified that only the test fakes Stripe:

  > Sobre el punto 1, si obvio ahorita es simulado pero porque etsamos en desarrollo no por que la app sea de juguete, recuerda que vamos a salir a prodcuion y simepre tartamos de contruir una app escalable desde el dia uno, no se si confundi tu comentario pero igual lo aclaro. sobre mis deciiones la vredad o puedo opinar no te sabria ual es la mejor y cual sigue la filosofia de selene, lo de un mvp++ y un repo escalable sin osbreingenieria por asi decir. Que opinas tu ?

  Agent decisions, accepted in L4: first lifecycle payment → cancellation → refund → transfer, overdue refund in a second commit; SQL RPCs only; `pr` group with a fixed budget plus a longer weekly run; no shared-helper migration, no `fc.scheduler`, no full TLA+ replica in TypeScript.

- **L4** — Maintainer, 2026-11-16:

  > va me parece bien master, luz vrede. luz vrede para el woktree.

- **L5** — Agent and parent session, 2026-11-16, while writing T1:
  - `RefundBeforeCancel` as a state invariant failed on unmodified code with `[ClaimCancellation(s0), StartRefund(s0), RefundEvent(s0, succeeded), RefundEvent(s0, failed)]`: the documented `failed_after_cancellation` path (#606), which the TLA+ model does not include (it models only the overdue refund's failure). Decided: check it as a step property (a shipment becomes cancelled only with a succeeded or resolved refund), plus two state checks beyond the model: a cancelled shipment's refund is succeeded, failed or resolved, and `RefundFailureVisible` (a cancelled shipment with an unresolved failed refund has the buyer's `shipment.refund_failed` notice). T4 records the model gap.
  - `RefundFailureVisible` then failed with `RecordRefund(s0, failed)` after the cancellation: `fn_record_shipment_cancellation_refund` accepts a silent succeeded → failed on a cancelled shipment. No caller reaches it today (the cancel Edge Functions record after their own claim, which a cancelled shipment refuses), so `RecordRefund` has that model precondition and the hardening is Finding #659.
  - Mutants: the event function completing on `failed` alone is masked by `fn_cancel_shipment`'s `REFUND_NOT_SUCCEEDED` guard, so M1 breaks both; M2 lets `fn_complete_shipment_transfer` overwrite a recorded transfer id. Other transfer fences are only reachable concurrently (TLC and the coordination harnesses).
  - Budget: with at most 20 commands a run averages 10 and only about 4.5% of runs complete the transfer path, so 50 runs missed it 1 time in 10; the default is 30 commands (about 13% of runs, a batch miss near 0.1%). A 0.1% red PR run with no bug is still a flaky check (maintainer, 2026-11-16), so a passing batch that misses an outcome runs up to 3 more batches with new random seeds and accumulated counters, and fails only if the outcome is still unreached; each batch prints its seed for replay. A fast-check commands replay needs `SELENE_MODEL_REPLAY_PATH` besides the seed and path.
