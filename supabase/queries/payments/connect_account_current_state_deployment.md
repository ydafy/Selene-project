# Deploy current Connect payout actionability safely

**Historical cutover confirmed; current-candidate review remains pending.** The [accepted closeout checkpoint](../../../odd/tasks/payout-account-current-destination-recovery.md) records maintainer confirmation of both `20261004055646_connect_account_current_state.sql` and `20261006040709_reject_null_payout_claim_inputs.sql`, the matching historical `stripe-webhooks` deployment, and external-account created/deleted subscriptions. Generation 1 accepted an actionable unique MXN default snapshot. The failed parent remained failed; its child reached paid with the matching amount and original Transfer reference.

This historical proof does not bind the deployed webhook to today's source hash, establish bank health now, or provide native approval for the current candidate. Repository files remain reference copies; local checks do not establish deployed behavior.

Maintainer-only handoff: this change replaces historical bank-event health with a generation-fenced current MXN default bank snapshot. The original preparation of this guide executed no remote SQL, API call, event redelivery, deployment, or money action. Later maintainer-confirmed execution is recorded in the checkpoint above.

## Historical cutover procedure: SQL first, immediately matching Edge

The following sequence preserves the original procedure, not a new instruction to repeat it. The two migrations named in the accepted checkpoint are already recorded as applied; do not reapply them or repeat the completed Retry scenario because this guide lists the original steps. Any future source synchronization or operational action requires separate maintainer authorization.

For a separately authorized maintenance window, keep payout release and Retry disabled operationally using existing project procedures. Do not temporarily disable the actionability gate or introduce an automatic control.

1. Execute **only** [`20261004055646_connect_account_current_state.sql`](../../migrations/20261004055646_connect_account_current_state.sql) through the Supabase Dashboard. Previous terminal/actionability/executor migrations are already applied; do not repeat them. [`connect_account_current_state.sql`](connect_account_current_state.sql) is the canonical copy, **not a second SQL execution**.
2. Immediately deploy **only** [`stripe-webhooks`](../../functions/stripe-webhooks/index.ts), including its matching reconciliation module. No admin deployment is required. SQL alone makes the old projector reject with `ACCOUNT_REFRESH_REQUIRED`; webhook deliveries during this gap must retry, not be treated as successful recovery. If RPC schema visibility lags, use the existing project schema-cache refresh procedure; this guide does not prescribe a repair command.
3. Confirm the Connect **sandbox** subscription includes `account.updated`, `account.external_account.created`, `account.external_account.updated`, and `account.external_account.deleted`. Preserve existing payout subscriptions and signing secret. No new secret or cron is required.
4. **Stop and wait for maintainer confirmation that SQL was applied remotely.** Only afterward run `bun db:types` as a separately authorized step. Verify generated types expose `fn_acquire_connect_account_refresh`, `fn_commit_connect_account_refresh`, and the seven new projection columns shown below. Existing generated types are not evidence that remote SQL was applied.

Acquisition commits before Stripe reads and leaves the gate pending on errors. A matching current-generation commit alone clears pending; superseded responses fail with `ACCOUNT_REFRESH_SUPERSEDED`. Generations order Selene writes, not Stripe events or mutations. A provider freshness window remains between retrieval and acceptance.

## Read-only verification after deployment

A privileged maintainer may execute the following exact read-only queries in the Dashboard SQL editor. Direct client/service-role table access is intentionally revoked. The first query separates current projection fields from historical trigger provenance; no row means legacy no-evidence compatibility, **not verified current health**.

```sql
SELECT stripe_account_id,
       refresh_generation, refresh_pending,
       current_external_account_id, external_account_status AS current_bank_status,
       current_currency, current_default_for_currency, current_mxn_default_count,
       payouts_enabled, is_actionable, blocked_reason, current_observed_at,
       source_event_id AS historical_trigger_event_id,
       stripe_created AS historical_trigger_created,
       updated_at
FROM public.connect_account_actionability
WHERE stripe_account_id = 'acct_1UMK0QAiJ7uod7jU';

SELECT stripe_event_id, stripe_account_id, event_type, stripe_created,
       payouts_enabled AS historical_payouts_enabled,
       external_account_id AS historical_bank_id,
       external_account_status AS historical_bank_status
FROM public.connect_account_events
WHERE stripe_account_id = 'acct_1UMK0QAiJ7uod7jU'
ORDER BY stripe_created, stripe_event_id;
```

Prior current fields can remain stored while `refresh_pending = true`; they are not usable authority then. Evidence is immutable: duplicate delivery must not rewrite its historical bank/status/flags, but must still perform a fresh retrieval.

## Human opt-in refresh, then a separate financial decision

At the original handoff, no healthy-replacement event had been offered. The accepted checkpoint subsequently recorded generation 1 with an actionable unique MXN default. That accepted snapshot is historical, not proof of present bank health. Bank `ba_1UMhfeAiJ7uod7jU4FVz9wt7` was initially user-reported; do not infer its current identity or health from the expected ID or automatically enable the gate.

If a refresh is needed, obtain explicit maintainer authorization for **one account-event redelivery** through the existing Stripe Dashboard workflow. The signed event's connected-account identity must match `acct_1UMK0QAiJ7uod7jU`. Do not invoke redelivery automatically or recommend changing a bank to manufacture an event. An independently occurring normal account/bank event can also trigger reconciliation; this guide does not authorize a bank mutation.

After the refresh, repeat the read-only queries and inspect the bounded webhook result. Require an accepted current snapshot with `refresh_pending = false`, `is_actionable = true`, `payouts_enabled = true`, no blocked reason, exactly one MXN default, and a healthy status (`new`, `validated`, or `verified`). The current bank must agree with independently inspected current Stripe account/default-bank state; historical trigger bank identity need not agree. A pending, refused, failed, or unknown snapshot is not success.

**Do not repeat the completed Retry scenario.** The accepted checkpoint records that parent `a627fd24-c2ea-4708-906f-8464e96e6b09` remained failed and child `a2cf0c65-80b4-489b-9337-9b5b49d46cb5` reached paid. A healthy gate still does not authorize money movement. For a separate future Retry decision, verify authoritative failed-payout/returned-funds evidence, the parent remains failed, no child already exists for that scenario, and the existing-Transfer reuse preflight passes under the [payout operating model](../../../openspec/specs/payout-operating-model/spec.md). Never create duplicate Transfers, add a new bank, or repair historical runs as part of this guide.

## Historical verification and current limits

Current local A6.4 verification: `bun test supabase/functions/stripe-webhooks` passed 194 tests with zero failures and 665 assertions across six files. This is current-worktree functional/source-read evidence, not an isolated checkout, full TypeScript check, current deployed-source equivalence, or provider E2E proof.

The following results belong to the original handoff, not a fresh verification of today's candidate. The independent verifier re-ran the 339 account/payout tests (1,653 assertions) and 54 settlement-helper tests (131 assertions): **393 passing tests, zero failures, 1,784 assertions**. SQL coverage is 22 structural tests, only six specific to the new migration. These results are not PostgreSQL runtime, live Stripe, or remote deployment proof.

Historical production Deno checking **PASSED**, exit 0 with no diagnostics, for this exact command; it was not rerun for the current A6.4 candidate:

```text
deno check --no-config --no-lock --no-npm --vendor=false --node-modules-dir=none supabase/functions/stripe-webhooks/connect-payout-reconciliation.ts supabase/functions/stripe-webhooks/index.ts
```

The original TS2322 in `single-modal-settlement.ts` was resolved by a separately authorized explicit `typeof` number guard. The helper still preserves valid integer cents and returns `null` for absent/invalid amounts. Ten direct characterization cases pass; metadata is copied without mutating input. The writer observed compiler RED→GREEN, and the independent verifier confirmed the complete webhook typecheck passes. No financial behavior change or unrelated fee-plan correction was made.

Historical native INSPECT was blocked on intended untracked selection and included 24 tracked paths with unrelated prior work. That checkpoint is not today's selected 19-file candidate, whose review remains pending; no historical result grants current-candidate approval. The previously documented webhook catch ignores Supabase DLQ insertion errors before its success log (historical `index.ts:1159–1164`); exhausted-retry durability remains an inherited limitation, not a fix made here. Operational verification and any release/Retry approval remain separate maintainer gates.
