# Proposal: Shipping Quote Financial Contract

## Intent

Deployed code contradicts `specs/shipments`; no spec defines the publication-fixed shipping reserve or makes it explicit, deterministic, testable before payout work. Checkout reconstructs the unpersisted reserve from current settings; the maintainer approved a Supabase migration persisting the publication-time seller economics snapshot for checkout reuse.

## Scope

### In Scope
- Spec delta: quote→reserve→settlement→label-evidence→refund-exclusion; fixes stale `shipments` text (`originAddressId`, claims).
- Deterministic quote: `get-shipping-quote` returns one Paquetexpress Ground MXN rate; rejects other carriers/services (no `ground_do`/`ground_od`).
- Reserve `Q + buffer + 1.2% insurance`; `label_provider_cost_cents` evidence only, never repricing payout.
- Publication persists the exact accepted shipping reserve plus commission and insurance-rate inputs (integer cents/rate representation); checkout must use the snapshot, not current settings, for a published product.
- Repository-only migration defines the snapshot schema.
- UI (en/es): Sell Details tooltip + preset/box-drift notice; Preparing packaging/branch-handoff guidance; no manual dimensions.
- TDD tests: `selectPaquetexpressGroundRate`, `calculateEstimatedSellerShippingDeductionCents`, `calculateCheckoutAllocation`, `allocateCancellationLossCents`, snapshot write/read.

### Out of Scope
Payout/reconciliation; post-carrier-charge deductions; pickup; `ground_do`/`ground_od`; remote SQL/deployment (Dashboard); checkout shipping selector; dead-artifact disposition.

## Capabilities

### New Capabilities
- `seller-shipping-reserve`: deterministic quote, reserve formula, publication-fixed payout persisted as snapshot, checkout reuse, evidence-only label cost, branch-handoff.

### Modified Capabilities
- `shipments`: replace stale quote/buyer-pays/atomic-update text with deployed single-origin quote, seller-paid reserve, claims.
- `single-modal-multiseller-checkout`: allocation sources reserve/commission from persisted snapshot, not settings.

## Approach

Exploration Approach 3: codify deployed behavior as contract; pin invariants with tests; no multi-seller redesign; integer cents; imperative migration persists snapshot.

## Affected Areas

- New `supabase/migrations/`: snapshot schema, repository-only.
- Modified `apps/frontend/core/hooks/usePublishProduct.ts`: persist reserve/commission/insurance-rate inputs.
- Modified `supabase/functions/get-shipping-quote/`, `_shared/`, `create-connect-payment/fee-calculator.ts`: deterministic response; snapshot allocation.
- Modified `apps/frontend/app/sell/details.tsx`, `app/profile/orders/prepare/[id].tsx`, `core/i18n/locales/{en,es}`: notice/guidance copy.

## Risks

- `ground` branch-admissibility unproven (Med): proof gate, not asserted.
- Reference-destination-vs-real-buyer-ZIP drift exceeds buffer (Med): buffer retained; evidence-only cost.
- No matching Envia rate (Med): reject; visible error.
- Legacy listings lack snapshot (Med): design defines fallback/backfill.
- Code ships before remote SQL (Med): repository-only; deployment-order gate.

## Rollback Plan

Revert folder; don't archive. Redeploy prior `get-shipping-quote`; remove i18n keys. Undeployed migration: delete file; deployed: paired down-SQL. Additive-only; no money mutation.

## Dependencies

- Migration repository-only until maintainer Dashboard deployment; `bun db:types` only after maintainer confirms remote SQL applied; report exact file, order, verification.
- **Proof gate**: one controlled production Paquetexpress Ground label admitted at a branch, receipt kept, first tracking verified.
- Research deselected; rely on exploration, observations, docs.

## Success Criteria

- [ ] Quote→reserve→payout→evidence→refund chain explicit; no buyer-pays text.
- [ ] Publication persists reserve/commission/insurance-rate snapshot; checkout reads it, not settings; `bun test` green.
- [ ] Types regenerated only after remote-SQL confirmation.
- [ ] en/es notice/guidance parity green.
- [ ] Branch-admission proof recorded pre-rollout.
