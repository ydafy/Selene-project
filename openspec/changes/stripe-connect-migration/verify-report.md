## Verification Report

**Change**: stripe-connect-migration  
**Version**: N/A  
**Mode**: Strict TDD (`bun test`)  
**Verdict**: **FAIL**

### Executive Summary

Focused re-verification confirms the previous W1 blocker is fixed: `create-return-intent` now requires `shipment_id`, loads the seller `stripe_account_id`, builds a return-shipping PaymentIntent with `on_behalf_of`, omits legacy `payment_method_types`, and has passing targeted Bun coverage.

However, the change is **not archive-ready** because source inspection found a money-movement contract violation: `create-connect-account` configures connected accounts with `settings.payouts.schedule.interval = 'manual'`, and `release-connect-payout` implements Selene-triggered payouts. This conflicts with the proposal/design intent that Stripe owns automatic daily seller payouts and that manual payout schedule control is out of scope.

Manual basic E2E evidence reported by the user is supplementary and positive, but it does not prove payout schedule correctness or replace runtime Stripe test-mode validation.

### Completeness

| Metric | Value |
|--------|-------|
| Proposal read | ✅ `proposal.md` |
| Specs read | ✅ 4 spec files |
| Design read | ✅ `design.md` |
| Tasks read | ✅ `tasks.md` |
| Previous report read | ✅ `verify-report.md` |
| Tasks total | 9 |
| Tasks complete | 9 |
| Tasks incomplete | 0 |

### Build, Tests, and Coverage Evidence

| Command | Result | Notes |
|---------|--------|-------|
| `bun test supabase/functions/create-return-intent/create-return-intent.test.ts supabase/functions/create-connect-payment/fee-calculator.test.ts apps/frontend/core/utils/connectPayment.test.ts supabase/queries/__tests__/connectMoneyFlowGuards.test.ts supabase/functions/drain-legacy-wallets/drain-legacy-wallets.test.ts supabase/functions/reconcile-connect-payments/reconcile-connect-payments.test.ts apps/admin-web/src/lib/connectOnboarding.test.ts apps/admin-web/src/lib/connectEarnings.test.ts` | ✅ 20 pass / 0 fail | Focused Stripe Connect suite including W1 regression test. |
| `bun test` | ✅ 314 pass / 0 fail | Full Bun suite is now clean. |
| `bun test --coverage ...focused files...` | ✅ 20 pass / 0 fail | Aggregate focused coverage: 97.22% functions / 99.10% lines. |
| `bunx tsc --noEmit --pretty false` in `apps/frontend` | ⚠️ Failed | Existing broad frontend type drift: Bun test typings, `EnrichedOrder.items/dispute`, `WizardSteps.steps`, `setupIntent`, etc. Not isolated to W1. |
| `bunx tsc -b --pretty false` in `apps/admin-web` | ⚠️ Failed | Existing admin type drift: `useAdminProduct`, unused destructuring, `locker_name`, unused `order`. Not isolated to W1. |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | Engram apply-progress #193 contains TDD Cycle Evidence. |
| All completed tasks have test evidence | ✅ | 6 task rows report test files for T-003, T-005, T-006, T-007, T-008, T-009; W1 follow-up adds `create-return-intent.test.ts`. |
| RED confirmed | ✅ | Reported test files exist. |
| GREEN confirmed | ✅ | Focused suite passed: 20/20 tests. |
| Triangulation adequate | ⚠️ | Helper/SQL unit coverage is good; full Stripe API/Webhook/PaymentSheet behavior still lacks automated E2E coverage. |
| Safety net for modified files | ✅ | Full `bun test` passed: 314/314. |

**TDD Compliance**: 5/6 checks passed; 1 warning for missing Stripe test-mode E2E automation.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit/static SQL | 20 | 8 | Bun |
| Integration | 0 | 0 | Not exercised in this verify slice |
| E2E | 0 | 0 | Manual basic E2E reported by user only |
| **Total executed** | **20 focused + 314 full suite** | **34 full-suite files** | |

### Changed File Coverage

| File | Line % | Branch % | Uncovered Lines | Rating |
|------|--------|----------|-----------------|--------|
| `supabase/functions/create-return-intent/create-return-intent.ts` | 100.00% | N/A | — | ✅ Excellent |
| `supabase/functions/create-connect-payment/fee-calculator.ts` | 92.31% | N/A | 25, 38, 55 | ⚠️ Acceptable |
| `apps/frontend/core/utils/connectPayment.ts` | 98.94% | N/A | — | ✅ Excellent |
| `apps/admin-web/src/lib/connectOnboarding.ts` | 100.00% | N/A | — | ✅ Excellent |
| `apps/admin-web/src/lib/connectEarnings.ts` | 95.24% | N/A | — | ✅ Excellent |
| `supabase/functions/drain-legacy-wallets/drain-legacy-wallets.ts` | 100.00% | N/A | — | ✅ Excellent |
| `supabase/functions/reconcile-connect-payments/reconcile-connect-payments.ts` | 100.00% | N/A | — | ✅ Excellent |

**Average focused changed-file line coverage**: 98.07%.

### Assertion Quality

**Assertion quality**: ✅ All change-related focused assertions verify concrete behavior. No tautologies, ghost loops, or type-only assertions were found in the focused Stripe Connect/W1 test files.

### Spec Compliance Matrix

| Requirement | Scenario / Contract | Runtime Evidence | Source Evidence | Result |
|-------------|---------------------|------------------|-----------------|--------|
| CON-004 | Return shipping PI is created on seller connected account | ✅ `create-return-intent.test.ts` passed | ✅ `on_behalf_of: input.stripeAccountId`; profile query requires `stripe_account_id`; `shipment_id` metadata included | ✅ COMPLIANT |
| CON-004 | Return shipping avoids legacy payment method pinning | ✅ `create-return-intent.test.ts` passed | ✅ `automatic_payment_methods`; no `payment_method_types` in helper | ✅ COMPLIANT |
| CON-002 | Per-seller Connect PaymentIntents use destination + application fee | ✅ `fee-calculator.test.ts`, `connectPayment.test.ts` passed | ✅ `create-connect-payment/index.ts` sets `transfer_data.destination` and `application_fee_amount` | ✅ COMPLIANT |
| CON-007 | Dual-path webhook routing | ✅ Full suite includes webhook-adjacent helper coverage; source inspection used for handler path | ✅ `stripe-webhooks` routes Connect by `metadata.seller_id`, legacy by `app_name` | ⚠️ PARTIAL |
| CON-008 | Connect shipments skip wallet release | ✅ `connectMoneyFlowGuards.test.ts` passed | ✅ `fn_cron_release_shipment_funds` filters `s.stripe_payment_intent_id IS NULL`; release guard skips wallet writes | ✅ COMPLIANT |
| CON-009 / order-lifecycle | Connect refunds use `reverse_transfer` and skip wallet rollback | ✅ `connectMoneyFlowGuards.test.ts` passed for SQL guard | ✅ `resolve-dispute-refund` sets `reverse_transfer = true` and skips `fn_complete_shipment_refund` for Connect | ✅ COMPLIANT |
| CON-005 | Legacy wallet drain is idempotent and preserves failed balances | ✅ `drain-legacy-wallets.test.ts` passed | ✅ Transfer idempotency key; wallet zeroed only after transfer success; failures audited | ✅ COMPLIANT |
| CON-011 | Reconcile missed Connect webhooks | ✅ `reconcile-connect-payments.test.ts` passed | ✅ Search by Connect metadata and calls `fn_create_shipment_from_payment` | ⚠️ PARTIAL |
| Proposal success criteria | Stripe automatic daily payouts, no platform-managed payout queue | ❌ No passing test | ❌ `create-connect-account` sets manual payout schedule; `release-connect-payout` triggers Selene-managed payouts | ❌ FAILING |

### Correctness Table

| Area | Status | Evidence |
|------|--------|----------|
| W1 return shipping `on_behalf_of` | ✅ FIXED | `supabase/functions/create-return-intent/create-return-intent.ts:20`; test line 22 expects `on_behalf_of: 'acct_seller'`. |
| Return intent seller account loading | ✅ FIXED | `index.ts` selects `stripe_customer_id, stripe_account_id`, rejects missing Connect account, passes `stripeAccountId` into helper. |
| Dynamic payment method rule | ✅ FIXED for return intent | Helper uses `automatic_payment_methods` and test asserts no `payment_method_types`. |
| Connect checkout money flow | ✅ IMPLEMENTED | `create-connect-payment` uses `transfer_data.destination`, `application_fee_amount`, metadata, and rollback on PI creation failure. |
| Wallet guards | ✅ IMPLEMENTED | SQL tests and source inspection confirm Connect guards before wallet writes. |
| Automatic daily payouts | ❌ FAILING | `create-connect-account` configures manual payout schedule and `release-connect-payout` creates platform-triggered payouts. |

### Design Coherence Table

| Design / Proposal Decision | Followed? | Notes |
|----------------------------|-----------|-------|
| Per-seller PI with `transfer_data.destination` | ✅ | Implemented in `create-connect-payment`. |
| Return shipping uses connected account routing | ✅ | W1 fixed with `on_behalf_of`. |
| Wallet deprecate/read-only for Connect-era orders | ✅ | SQL guards and UI deprecation paths verified. |
| DLQ + reconcile jobs | ✅ | Webhook DLQ and `reconcile-connect-payments` exist. |
| Stripe automatic daily payouts; no manual payout schedule control | ❌ | Implementation explicitly uses manual payout schedule and a Selene payout release function. This violates proposal scope/out-of-scope and the stated regulatory intent to exit money holding. |

### Issues Found

#### CRITICAL

1. **C1: Connect account payout schedule contradicts the migration contract.**  
   - **Evidence**: `supabase/functions/create-connect-account/index.ts` sets `settings.payouts.schedule.interval = 'manual'` for both Accounts v2 and v1 fallback. `supabase/functions/release-connect-payout/index.ts` then scans completed Connect shipments and calls `stripe.payouts.create` from Selene.  
   - **Why this blocks archive**: `proposal.md` says automatic daily payouts via Stripe are final, manual payout schedule control is out of scope, and the platform exits money-holding/payout operations. Manual schedule reintroduces platform-controlled payout timing.  
   - **Impact**: Sellers may not receive Stripe automatic daily payouts; Selene remains responsible for payout orchestration and operational failure modes.  
   - **Required action**: Either remove manual payout scheduling/platform-triggered payout flow or revise proposal/spec/design/tasks to explicitly approve the escrow-style manual Connect payout architecture and add tests for it.

#### WARNING

1. **W1 resolved**: Previous return-shipping `on_behalf_of` warning is closed by source inspection and runtime tests.
2. **W2: No automated Stripe test-mode E2E coverage**: User-reported manual basic E2E passed, but automated coverage still does not exercise real Stripe Accounts v2, PaymentSheet confirmations, webhook replay, reverse-transfer refunds, payout schedules, or transfer drain against Stripe test mode.
3. **W3: Broad TypeScript checks still fail**: Failures appear unrelated to the W1 fix and mostly match existing project drift, but they remain quality debt before a production release.
4. **W4: `drain-legacy-wallets` fetches zero-balance wallets**: Query uses `.gte('available_balance', 0)` and filters later. Low impact, one-time admin operation.

#### SUGGESTION

1. Add a regression test that asserts Connect account creation does not configure manual payouts if automatic daily payouts remain the accepted design.
2. Add Stripe test-mode smoke/E2E scripts for: account onboarding status, multi-PI checkout, return-shipping PI, reverse-transfer refund, webhook replay, and legacy drain dry-run.

### Final Verdict

**FAIL — not archive-ready.**

All 9 tasks are checked and the W1 return-shipping fix is verified with passing runtime tests. The focused suite and full Bun suite pass. Archive remains blocked by the manual Connect payout implementation, which contradicts the approved proposal/design money-movement contract.
