# Payout Release SQL Baseline Repair

## Goal
Repair only the three broad-suite failures blocking Phase 2A closure: payout release amount/view contract parity and guard expectations.

## Scope

### In scope
- `admin_connect_payout_release_view_shipping_cost_fix.sql` and directly matching canonical payout release SQL.
- Matching payout release amount/view migration contract if parity requires it.
- Directly relevant static SQL guard tests.
- Focused TDD and re-running the broader Phase 2A triangulation suite.

### Out of scope
- Event ledger/reconciliation implementation changes.
- Phase 2B payout executor/stage persistence.
- Phase 2C fee worker.
- Admin UI, remote SQL/deploy, generated types, manual E2E.
- Cancellation, refund, and dispute behavior.

## Tasks

- [x] **1. Map exact failing assertions against migration and canonical SQL**
  - The three failures are stale static guards, not an operational SQL defect: approved specs, migration headers, generated types, and canonical SQL agree on allocation-only single-modal amounts, legacy `shipping_cost` deduction, and the 22-column append-only retry-era view.
  - `label_provider_cost_cents` is evidence-only and cannot coexist with the current amount-contract guard; SQL/migration edits would contradict the contract and risk view consumers.

- [x] **2. Add or update RED guard behavior**
  - RED (pre-edit, guards only, SQL untouched): 3 failures — `connectMoneyFlowGuards.test.ts` "deducts the validated actual label cost" (expected stale `- s.label_provider_cost_cents`), `connectMoneyFlowGuards.test.ts` "14-column admin view shape" (`FROM shipment_amounts;` lookup returned -1, view is 22 columns), `payout-release-amount-contract.test.ts` eligibility predicate (expected unqualified `transfer_group`/`has_shipping_cost_cents`; operational copy is `sa.`-qualified).
  - Repaired only the three stale guards (no SQL/migration/canonical edits needed — the existing SQL already matched the contract).

- [x] **3. Repair SQL/migration parity under focused tests**
  - NARROWED per maintainer delegation: SQL was already at parity; guard-only repair. `connectMoneyFlowGuards.test.ts` now asserts canonical legacy shipping-cost deduction (`- COALESCE(s.shipping_cost, 0)`, `has_shipping_cost_cents`, `missing_shipping_cost`) and rejects `label_provider_cost_cents`; view-shape test robustly locates `FROM shipment_amounts` (no semicolon) and validates the 22-column append-only tail order; eligibility predicate accepts unqualified and `sa.`-qualified spellings.

- [x] **4. Restore broad verification**
  - GREEN: `bun test supabase/queries/__tests__/connectMoneyFlowGuards.test.ts supabase/queries/__tests__/payout-release-amount-contract.test.ts` → 18 pass / 0 fail (105 expects).
  - Regressions: `bun test supabase/migrations/__tests__/single_modal_checkout_settlement.test.ts supabase/migrations/__tests__/connect_manual_payout_release.test.ts supabase/queries/__tests__/singleModalSettlementSqlGuards.test.ts` → 38 pass / 0 fail (182 expects).
  - Whitespace: `git diff --check --no-index /dev/null <each edited test>` → exit 1 (expected no-index difference status), zero whitespace diagnostics (only an autocrlf LF→CRLF notice on the untracked file).
  - Return to the paused Phase 2A closure/deployment handoff only after green evidence.

- [x] **5. Test-guard repair: outer projection cardinality must be counted, not inferred from ordered tokens (independent finding, surgical TDD)**
  - Weakness: the 22-column view-shape guard only verified expected tokens appear in ordered fashion, so an extra appended outer column was silently accepted. Proven by mutation: injecting `, sa.extra_unauthorized_column` before the outer `FROM shipment_amounts` still passed every ordered-token assertion.
  - RED (pre-implementation, test-only): new tests `admin payout release view outer SELECT projects exactly 22 top-level columns` and `... guard rejects an extra appended outer column` failed with `getOuterViewProjectionColumns is not defined` (1 fail / 16 pass).
  - GREEN: added `getOuterViewProjectionColumns` (isolates the outer `SELECT ... FROM shipment_amounts` span — nearest SELECT before the outer FROM, robust to inner CTE/subquery SELECTs) and `splitTopLevelProjectionColumns` (top-level comma splitter, parenthesis- and SQL-string-aware, handling `''` escapes) in the test file; expression columns anchored by trailing `AS` alias / qualified-ref tail in exact positional order. Focused suite: 17 pass / 0 fail (126 expects).
  - TRIANGULATE: old ordered-token check PASSES the mutated 23-column projection (weakness observed); new cardinality guard REJECTS it (count 23 vs expected 22 throws). SQL file untouched.

## Evidence
- Engram mirror: `odd/payout-release-sql-baseline-repair/tasks`.
- Phase 2A remains paused; no deploy, migration application, type regeneration, or E2E is authorized.
