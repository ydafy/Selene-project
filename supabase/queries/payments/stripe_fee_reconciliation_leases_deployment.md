# Stripe fee worker lease cutover

## Status and boundaries

Repository artifacts only: no remote SQL, Edge deployment, scheduler change, or
live job repair has been performed by this change. This migration is the sole
execution source; there is no separate canonical fee SQL copy.

The worker reads stored order charge evidence and authoritative Stripe balance
transactions. It does not repeat checkout settlement or create payments,
Transfers, Payouts, refunds, cancellations, or shipment changes. Existing non-NULL
fees are preserved. SQL completes fee projection and job success atomically.

This cutover recovers existing fee jobs; it does not establish that new-job
enqueue is deployed. At the recorded pre-correction HEAD, missing fee evidence
still throws instead of enqueueing. Deferred enqueue lives in the separate
pending `stripe-webhooks/index.ts` and `single-modal-settlement.ts` work unit.
Confirm that producer's deployment separately before claiming new-job end-to-end
recovery; do not deploy the pending webhook merely as part of this lease cutover.

## Maintainer execution order

1. Pause the existing protected fee-worker scheduler and allow existing requests
   to drain. Do not invoke the old worker during cutover.
2. In the Supabase Dashboard, execute exactly:
   `supabase/migrations/20261007000000_stripe_fee_reconciliation_leases.sql`.
   Prerequisites are the existing fee table and RPC migrations:
   `20260918013144_stripe_fee_reconciliation_jobs.sql`,
   `20260918020041_stripe_fee_reconciliation_job_rpcs.sql`, and
   `20260918063331_complete_stripe_fee_reconciliation_job.sql`.
   Do not reapply these historical migrations as part of this cutover.
3. Confirm successful SQL application to the development orchestrator. Only after
   that confirmation run `bun db:types`. Inspect generated job Row/Insert/Update
   ownership fields and the three `_leased` RPC argument/result shapes. Replace
   the explicitly documented worker-local future-schema bridge with generated
   contracts in a separately authorized update, then rerun focused tests/checks.
4. Deploy only `reconcile-stripe-fees` with the matching leased-RPC worker. No
   `stripe-webhooks` replacement is required by this lease correction.
5. Verify the existing worker bearer secret and scheduler configuration, then
   resume the protected scheduler. No new scheduler or secret is introduced.
   Existing Edge environment requirements remain `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, and
   `STRIPE_FEE_RECONCILIATION_WORKER_SECRET`. Scheduler POST authorization uses
   the existing worker-secret bearer value, not a client-provided financial input.
   Never print secret values or place them in repository files.

SQL-first deployment deliberately makes every legacy tokenless claim,
transition, and completion RPC raise `STRIPE_FEE_LEASE_REQUIRED`. Old/in-flight
workers cannot mutate claimed jobs after the migration. Do not roll back by
restoring tokenless RPCs; keep the scheduler paused if the Edge replacement fails.

## Ownership and recovery

- Each claim receives a fresh UUID and a fixed five-minute database-clock lease.
- Claim selection locks at most `p_limit` rows (1–100), using SKIP LOCKED. It
  includes due pending jobs, expired processing jobs, and legacy processing with
  NULL token/expiry whose `updated_at` is at least five minutes old.
- Within that same bounded selection, exhausted jobs become failed with
  `STRIPE_FEE_ATTEMPTS_EXHAUSTED`. They cannot remain permanently processing.
  Active, unexpired processing owners are never reclaimed.
- Transition/completion lock the job before checking ownership. Completion also
  locks the order and checks its PaymentIntent identity before writing the fee.
  `clock_timestamp()` is checked after those locks; transaction/statement-start
  `now()` would incorrectly extend ownership across a lock wait. No application
  timestamp controls claim validity. The supplied reconciliation timestamp is
  projection metadata only.
- NULL, nonexistent, wrong, stale, or expired active tokens return false. Only a
  matching retained successful token can replay completion, returning true
  without further writes; active expiry is cleared on success. Retry/failure
  clears both token and expiry. Transition never accepts success.
- A completion IO failure can be ambiguous. The worker reports an allowlisted
  code and leaves the claim for replay/expiry, rather than issuing another state
  transition after possible success. Per-job lookup/transition failures do not
  abort remaining jobs. False/malformed mutation responses never count success.

## Post-deployment checks (maintainer-controlled)

Check job columns, all six RPC ACLs, and three versioned signatures in the remote
catalog. Confirm PUBLIC/anon/authenticated cannot execute them and service_role
can. Verify unauthorized worker requests return 401 before any claim.

In an explicitly authorized sandbox, verify an interrupted lease cannot be
reclaimed before expiry, is reclaimed afterward with a different token, and the
old token cannot complete. Verify same-token completion replay performs no fee
overwrite, exhausted processing becomes failed, and order/PaymentIntent mismatch
cannot write a fee. Check remaining batch jobs progress after a job IO error.
Do not repair historical jobs or trigger financial behavior without separate
maintainer authorization.

Observe response counters (`selected`, `succeeded`, `retryScheduled`, `failed`,
`errors`) and `stripe_fee_job_error` logs containing only job ID and allowlisted
`STRIPE_FEE_CLAIM_LOST` / `STRIPE_FEE_JOB_IO_FAILED` codes. Claim-level failure is
not a successful batch. SQL terminalizations are not included in `selected`,
which counts only returned active claims; inspect failed ledger rows separately.

## Local evidence and residual limitations

Run:

```sh
bun test supabase/functions/reconcile-stripe-fees/index.test.ts supabase/migrations/__tests__/stripe_fee_reconciliation_recovery.test.ts supabase/migrations/__tests__/stripe_fee_reconciliation_lease.test.ts
deno check --no-config --no-lock --no-npm --vendor=false --node-modules-dir=none supabase/functions/reconcile-stripe-fees/index.ts
bun test supabase/functions/stripe-webhooks/single-modal-settlement.test.ts supabase/migrations/__tests__/stripe_fee_reconciliation_recovery.test.ts
```

Bun worker IO is mocked; SQL tests inspect source, not PostgreSQL execution.
Neither proves live locking, scheduler deployment, or provider behavior. Fixed
leases may expire during slow Stripe reads; completion then refuses safely and
recovery consumes the bounded attempt budget. No heartbeat is introduced. Direct
service-role table access remains privileged as before; RPC fences do not protect
against arbitrary privileged SQL. The future-schema bridge is not evidence that
the deployed generated schema already includes this migration.
