# Apply Progress: stripe-fee-gross-up

## TDD Cycle Evidence

| Behavior | Safety Net | RED test | Failure reason | GREEN implementation | Focused result | Broader result |
|---|---|---|---|---|---|---|
| Gross-up math + cent allocation | Existing shared helper tests | `supabase/functions/_shared/stripe-fee-gross-up.test.ts` | Missing pure integer gross-up helper and deterministic allocation logic | Added `_shared/stripe-fee-gross-up.ts` with `grossUpDomesticMx` and `allocateCents` | `bun test supabase/functions/_shared/stripe-fee-gross-up.test.ts` ✅ | `bun test` ✅ (792 tests) |
| Checkout parity | Existing checkout and frontend helper tests | `supabase/functions/create-connect-payment/fee-calculator.test.ts`, `single-payment-builder.test.ts`, `apps/frontend/core/utils/connectPayment.test.ts`, `apps/frontend/core/hooks/useOrderCalculations.test.ts` | Buyer total still needed order-level gross-up and frontend parity wiring | Wired gross-up math into fee calculator, builder metadata, and frontend helpers | `bun test supabase/functions/create-connect-payment` ✅; `bun test apps/frontend/core/utils/connectPayment.test.ts apps/frontend/core/hooks/useOrderCalculations.test.ts` ⛔ not rerun separately | `bun test` ✅ |
| Webhook reconciliation | Existing webhook tests | `supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` | Settlement flow lacked authoritative Stripe fee reconciliation | Added balance-transaction fee capture and idempotent persistence | `bun test supabase/functions/stripe-webhooks` ✅ | `bun test` ✅ |
| Refund basis | Existing refund basis tests | `supabase/functions/_shared/refund-basis.test.ts` | Cancellation refund basis still needed actual-fee allocation and NULL handling | Added `allocateCancellationLossCents` | `bun test supabase/functions/_shared/refund-basis.test.ts` ✅ | `bun test` ✅ |
| Cancel-order sequential partial cancellation | Existing cancel-order tests | `supabase/functions/cancel-order/cancel-order.test.ts` | Sequential partial cancellations needed cumulative loss capping | Updated cancel-order flow to pass allocated loss through the RPC path | `bun test supabase/functions/cancel-order` ✅ | `bun test` ✅ |
| Source + SQL guards | Existing guard tests | `supabase/functions/__tests__/shipmentCancelSafetySourceGuards.test.ts`, `supabase/queries/__tests__/shipmentCancelSafetySqlGuards.test.ts` | Guard coverage needed to prove service-role RPC and SQL signature safety | Kept source/SQL guard assertions aligned with the shipment cancel path | `bun test supabase/functions/__tests__/shipmentCancelSafetySourceGuards.test.ts` ✅; `bun test supabase/queries/__tests__/shipmentCancelSafetySqlGuards.test.ts` ✅ | `bun test` ✅ |

## Completed
- [x] 1.0 Read `packages/types/src/database.types.ts` and `packages/types/src/index.ts`
- [x] 1.1 Added RED tests for `grossUpDomesticMx` and `allocateCents`
- [x] 1.2 Implemented `supabase/functions/_shared/stripe-fee-gross-up.ts`
- [x] 1.3 Added migration for new order audit columns and `fn_cancel_shipment` loss persistence
- [x] 1.4 Verified regenerated `packages/types/src/database.types.ts` now includes the new order audit columns after maintainer-applied migration + `bun db:types`
- [x] 2.1-2.4 Checkout integration and frontend total parity wired to gross-up math
- [x] 3.1-3.3 Webhook reconciliation writes actual Stripe fee when available, leaves NULL + retry path when not
- [x] 4.1-4.4 Cancellation-loss allocation now uses reconciled fee and flows through cancel/auto-cancel paths
- [x] 5.2 Verified the spec scenarios with focused and full test coverage (500,000 -> 522,154; loss allocation; NULL unreconciled; service fee excludes Stripe fee)
- [x] 5.1 Verification checks completed under the maintainer-approved scoped baseline exception: `bun test`, changed-file ESLint, and `packages/types` typecheck pass; repo-wide lint/frontend typecheck failures were proven outside changed paths and remain excluded baseline debt.

## Blocked
None.

## Commands Run

- `bun test supabase/functions/_shared/stripe-fee-gross-up.test.ts` ✅
- `bun test supabase/functions/create-connect-payment` ✅
- `bun test supabase/functions/stripe-webhooks` ✅
- `bun test supabase/functions/_shared/refund-basis.test.ts` ✅
- `bun test supabase/functions/cancel-order` ✅
- `bun test supabase/functions/__tests__/shipmentCancelSafetySourceGuards.test.ts` ✅
- `bun test supabase/queries/__tests__/shipmentCancelSafetySqlGuards.test.ts` ✅
- `bun test` ✅ (792 pass, 0 fail)
- `bun run lint` ⛔ failed on pre-existing baseline issues in frontend tests/components and unrelated type gaps
- `bunx tsc --noEmit -p packages/types/tsconfig.json` ✅
- `bunx tsc --noEmit -p apps/frontend/tsconfig.json` ⛔ failed on pre-existing `bun:test` / `ImportMeta.dir` / frontend type gaps
- `bunx eslint supabase/functions/_shared/stripe-fee-gross-up.ts supabase/functions/_shared/refund-basis.ts supabase/functions/create-connect-payment/fee-calculator.ts supabase/functions/create-connect-payment/single-payment-builder.ts supabase/functions/stripe-webhooks/index.ts supabase/functions/cancel-order/cancel-order.ts supabase/functions/cancel-order/index.ts supabase/functions/auto-cancel-orders/index.ts supabase/functions/auto-cancel-preparing/index.ts` ✅
- `bunx eslint apps/frontend/core/utils/connectPayment.ts apps/frontend/core/hooks/useOrderCalculations.ts` ✅

## Notes
- Full `bun test` passed (792 tests).
- Repo-wide lint still fails on pre-existing baseline errors outside this change set.
- `packages/types` typecheck passed; `apps/frontend` typecheck still fails on pre-existing Bun/React type gaps.
- Maintainer accepted only proven repo-wide TypeScript/ESLint failures outside changed files as scoped baseline exceptions; failures in changed files remain blocking.
- Maintainer confirmed the migration was applied, DB types regenerated, and all affected Edge Functions deployed: `create-connect-payment`, `stripe-webhooks`, `cancel-order`, `auto-cancel-orders`, and `auto-cancel-preparing`.
