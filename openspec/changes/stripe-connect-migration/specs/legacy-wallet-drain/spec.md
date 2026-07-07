# DEPRECATED: Este archivo está obsoleto y se eliminará en la próxima versión.

# Delta for Legacy Wallet Drain

## ADDED Requirements

### Requirement: CON-005 — Mass Wallet Drain to Connect

The system MUST provide a `drain-legacy-wallets` edge function that transfers each seller's `wallets.available_balance` to their Stripe Connect account via `stripe.transfers.create`. The function MUST be idempotent: only zero the wallet balance after a successful Transfer. Failed Transfers MUST be logged to `admin_audit_logs` without modifying the wallet balance, allowing admin retry.

#### Scenario: Mass drain of wallet balances to Connect accounts

- GIVEN an admin triggers the drain with `connect_enabled = true` and all active sellers onboarded
- WHEN the drain function executes
- THEN it iterates sellers with `available_balance > 0`, creates a Stripe Transfer per seller to their `stripe_account_id`, and zeros the wallet only on success

#### Scenario: Seller has zero wallet balance

- GIVEN a seller with `wallets.available_balance = 0`
- WHEN the drain function processes this seller
- THEN the system skips the Transfer and logs a no-op entry

#### Scenario: Transfer fails for one seller

- GIVEN a seller whose Stripe Transfer fails (e.g., account restricted)
- WHEN the drain function processes this seller
- THEN the system logs the failure to `admin_audit_logs`, preserves the wallet balance, and continues to the next seller

### Requirement: CON-012 — Legacy Table Deprecation

After Phase 6 drain completion, the tables `wallets`, `wallet_transactions`, `payout_requests`, and `seller_bank_accounts` MUST be treated as read-only historical audit records. No new writes MUST occur to these tables for Connect-era orders. The functions `fn_request_payout`, `fn_complete_shipment_refund` (for Connect paths), and `fn_cron_release_shipment_funds` (for Connect paths) MUST be effectively no-ops for Connect shipments.

#### Scenario: Legacy payout path is read-only

- GIVEN a Connect-era order completes
- WHEN the system processes order completion
- THEN no `wallet_transactions` or `payout_requests` rows are created

#### Scenario: Admin views Connect earnings instead of wallet ledger

- GIVEN the admin payments overview page loads after Phase 6
- WHEN the admin views payment history
- THEN the page shows Connect-sourced earnings (application fees, transfer amounts) instead of wallet ledger entries
