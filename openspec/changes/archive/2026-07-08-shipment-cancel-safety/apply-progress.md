# Apply Progress: shipment-cancel-safety

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | REFACTOR |
|------|-----------|-------|------------|-----|-------|----------|
| Refund basis correctness | `supabase/functions/cancel-order/cancel-order.test.ts` | Unit | ✅ Existing cancel-order tests passed before the change | ✅ Written | ✅ Passed | ✅ Single-shipment, multi-shipment, and cap-guard cases |
| Friendly cancel failure toast | `tests/shipment-cancel-safety.test.ts` | Unit | ✅ Existing frontend helper tests passed before the change | ✅ Written | ✅ Passed | ✅ Maintenance error mapping case |
| Actor-aware preparing-window copy | `tests/shipment-cancel-safety.test.ts` | Unit | ✅ Existing helper tests stayed green while adding the new case | ✅ Written first | ✅ Passed | ✅ Extracted pure helper and kept unboxing notice untouched |
| Shared refund basis helper | `supabase/functions/_shared/refund-basis.test.ts` | Unit | N/A (new file) | ✅ Written | ✅ Passed | ✅ Real example, multi-shipment split, seller-shipping exclusion |
| Seller manual cancel plan | `supabase/functions/cancel-order/cancel-order.test.ts` | Unit | ⚠️ Existing file; no separate pre-edit baseline captured | ✅ Written | ✅ Passed | ✅ Seller own-paid-shipment allowlist + preparing reject |
| Seller cancel gate + SQL guard | `tests/shipment-cancel-safety.test.ts` / `supabase/queries/__tests__/shipmentCancelSafetySqlGuards.test.ts` | Unit | ⚠️ Existing files; no separate pre-edit baseline captured | ✅ Written | ✅ Passed | ✅ Seller CTA on paid only; SQL seller branch mirrors buyer branch |

## Commands Run

- `bun test "supabase/functions/cancel-order/cancel-order.test.ts"`
- `bun test "tests/shipment-cancel-safety.test.ts"`
- `bunx eslint "apps/frontend/core/utils/shipment-cancel-safety.ts" "apps/frontend/core/hooks/useOrderActions.ts" "apps/frontend/app/profile/orders/[id].tsx" "supabase/functions/cancel-order/cancel-order.ts" "supabase/functions/cancel-order/index.ts" "supabase/functions/cancel-order/cancel-order.test.ts" "tests/shipment-cancel-safety.test.ts"`
- `bun test`
- `bun test "tests/shipment-cancel-safety.test.ts"` (RED/GREEN for actor-aware copy)
- `bun test "supabase/functions/_shared/refund-basis.test.ts" "supabase/functions/cancel-order/cancel-order.test.ts" "tests/shipment-cancel-safety.test.ts" "supabase/queries/__tests__/shipmentCancelSafetySqlGuards.test.ts"`
- `bunx eslint "supabase/functions/_shared/refund-basis.ts" "supabase/functions/cancel-order/cancel-order.ts" "supabase/functions/cancel-order/index.ts" "supabase/functions/auto-cancel-orders/index.ts" "supabase/functions/auto-cancel-preparing/index.ts" "apps/frontend/core/utils/shipment-cancel-safety.ts" "apps/frontend/core/hooks/useShipments.ts" "supabase/functions/_shared/refund-basis.test.ts" "supabase/functions/cancel-order/cancel-order.test.ts" "tests/shipment-cancel-safety.test.ts" "supabase/queries/__tests__/shipmentCancelSafetySqlGuards.test.ts"`
- `bun test`

## Notes

- The refund path now excludes seller-paid shipping and uses the original charge / remaining refundable cap as the safety boundary.
- Seller manual cancel is now allowed only for the seller's own paid shipment; preparing remains cron-only.
- Auto-cancel crons now reuse the shared buyer-paid refund basis and cap against the actual charge when available.
- Cancel failures now surface via the existing toast path instead of bubbling as an unhandled promise rejection.
- The preparing-window SLA banner now resolves copy by viewer role via a pure helper, so buyers see reassurance and sellers see direct carrier-scan guidance.
- Focused verify blocker fix: local Deno Edge imports now include `.ts` extensions, and OpenSpec spec/design now match seller-owned paid cancellation while keeping preparing cron-only.
