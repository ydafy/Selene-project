# Tasks: Hardened Buyer Shipment Confirmation

## Review Workload Forecast

Estimated changed lines: 1,500–2,000
400-line budget risk: High
Exceeds 1,200-line session budget: Yes
Chained PRs recommended: Yes
Chain strategy: pending — maintainer decides before apply
Delivery strategy: ask-on-risk

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Schema, ledger, RPC, grants, legacy drop | — | `bun test supabase/migrations/__tests__/confirm_shipment_hardening.test.ts` | Source guard only; maintainer-only remote SQL apply is a Phase 6 deployment/verification task | migration + canonical SQL |
| 2 | Buyer `confirm-shipment-delivery` Edge Function | — | `bun test supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` | serve + curl | function dir |
| 3 | `complete-delivered-shipments` scheduler | — | `bun test supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` | curl | function dir |
| 4 | Types registry + contracts | — | `bun test packages/types/src/confirmShipmentContracts.test.ts` | N/A | `packages/types/src/index.ts` + test |
| 5 | Frontend gate/copy/routing/fallback retirement | — | `bun test apps/frontend/tests/orders/shipment-confirmation.test.ts` | Expo dev | frontend files + test |
| 6 | Deployment handoff + provider validation boundary | — | N/A | N/A | handoff doc |

Scope exclusions preserved.

## Phase 1: Schema & Canonical SQL

- [x] 1.1 RED: Write `supabase/migrations/__tests__/confirm_shipment_hardening.test.ts` asserting schema, ledger, RPC, grants, legacy drop.
- [x] 1.2 Implement `supabase/migrations/20260903002546_confirm_shipment_hardening.sql`: add `buyer_confirmed_at`, ledger, due index, RPC, grants; drop legacy.
- [x] 1.3 Update `supabase/queries/orders/fn_confirm_shipment_delivery.sql`; delete `supabase/queries/orders/fn_confirm_delivery.sql`.
- [x] 1.4 GREEN: Run focused migration source guard; this does not execute SQL.

## Phase 2: Buyer Edge Function

- [x] 2.1 RED: Write `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` for auth, maintenance, ownership, state, dispute, idempotency, Connect, audit.
- [x] 2.2 Implement `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.ts` pure helper.
- [x] 2.3 Implement `supabase/functions/confirm-shipment-delivery/index.ts` endpoint.
- [x] 2.4 GREEN: Run focused Edge Function tests.

## Phase 3: Auto-Completion Scheduler

- [x] 3.1 RED: Write `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.test.ts` for cron secret, batch bound, 48h eligibility, retry idempotency, race.
- [x] 3.2 Implement `supabase/functions/complete-delivered-shipments/complete-delivered-shipments.ts` pure helper.
- [x] 3.3 Implement `supabase/functions/complete-delivered-shipments/index.ts` endpoint.
- [x] 3.4 GREEN: Run focused scheduler tests.

## Phase 4: Types Registry & Contracts

- [x] 4.1 RED: Write `packages/types/src/confirmShipmentContracts.test.ts` for registry contract.
- [x] 4.2 Add `confirm-shipment-delivery` entry to `EdgeFunctionRegistry` in `packages/types/src/index.ts`.
- [x] 4.3 GREEN: Run contract test.
- [x] 4.4 After remote SQL confirmed, run `bun db:types`; verify `packages/types/src/database.types.ts` has new column/table.

## Phase 5: Frontend Permissions, Copy & Routing

- [x] 5.1 RED: Write `apps/frontend/tests/orders/shipment-confirmation.test.ts` for delivered-only gate, isolation, routing, fallback retirement, copy.
- [x] 5.2 Implement `apps/frontend/core/utils/shipment-confirmation.ts` for idempotency key and error mapping.
- [x] 5.3 Modify `apps/frontend/core/hooks/useShipments.ts`: `canConfirmDelivery = isBuyer && status === 'delivered' && !activeDispute`.
- [x] 5.4 Modify `apps/frontend/core/hooks/useOrderActions.ts`: invoke `confirm-shipment-delivery`, remove `fn_confirm_delivery` fallback.
- [x] 5.5 Update `apps/frontend/app/profile/orders/[id].tsx` and locales `en/orders.json`, `es/orders.json` for new dialog/copy.
- [x] 5.6 GREEN: Run focused frontend test.

## Phase 6: Deployment Handoff

- [x] 6.1 Create `openspec/changes/confirm-shipment/deployment-handoff.md` with SQL order, deploy, secrets, smoke checks, validation.
- [x] 6.2 Verify handoff states migration first, functions second, `bun db:types` after SQL, cron uses Vault anon JWT + `x-cron-secret`.
- [x] 6.3 Maintainer applied `supabase/migrations/20260903002546_confirm_shipment_hardening.sql` and confirmed manual type generation; generated-type structural evidence and the maintainer-supplied all-true live SQL verification result are recorded in `deployment-handoff.md` before function deployment.

No commits/PRs/deploy without explicit maintainer approval.
