# Proposal: Hardened Buyer Shipment Confirmation (confirm-shipment)

## Intent

Buyer confirmation allows `shipped → completed`, bypassing carrier delivery and the 48h grace, making shipments prematurely Connect-payout-eligible. `fn_confirm_shipment_delivery` mutates deprecated wallet tables for Connect shipments, runs as a direct authenticated RPC violating the Edge-Function financial invariant, and has no idempotency or audit. Legacy order-level `fn_confirm_delivery` remains callable.

## Scope

### In Scope

- Buyer manual confirmation only from `delivered`: shipment-scoped, buyer-authorized, idempotent, auditable, Connect-aware.
- New `confirm-shipment-delivery` Edge Function → narrowly granted service-role RPC; `fn_confirm_shipment_delivery` rewritten in place.
- Add `shipments.buyer_confirmed_at` (explicit confirmation only); scheduled 48h auto-completion after carrier-recorded delivery leaving it NULL, with separate durable audit evidence, race-safe.
- Retire `fn_confirm_delivery` and its client fallback in the same change.
- Frontend: delivered-only gate, honest copy, idempotent routing, per-shipment isolation.
- Migration + manual deployment handoff; strict TDD, focused verification.

### Out of Scope

- Post-dispute reconfirmation (deferred); quote economics / MXN 30 buffer.
- Cancellation, disputes, label/tracking redesign, Stripe payout redesign; admin release mechanics unchanged unless a minimal gate adjustment proves necessary.
- Remote deployment, Docker/CI/tooling config, worktrees/issues/PRs/RDD.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `shipments`: delivered-only confirmation via privileged Edge Function; legacy confirmation retired; `buyer_confirmed_at` added; 48h auto-completion with distinct audit source; `canConfirmDelivery` gate tightened. `connect-payout-release` intentionally unchanged.

## Approach

Mirror `cancel-order`: plan helper + Edge Function (maintenance gate, buyer auth, idempotency key `confirm_shipment_{shipmentId}`). RPC body swapped in place: delivered-only, Connect guard skips wallet writes with INFO audit. Scheduled function completes unconfirmed shipments 48h after `delivered_at` with an audit-source marker; `completed_at` exists only after delivery, so the unchanged admin queue stops exposing premature rows. Stripe/Envia uncertainties stay explicit; bounded sandbox/manual validation required before production.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/confirm-shipment-delivery/` | New | Privileged confirmation Edge Function |
| `supabase/functions/complete-delivered-shipments/` | New | Scheduled 48h completion + audit |
| `supabase/migrations/<ts>_confirm_shipment_hardening.sql` | New | RPC swap, `buyer_confirmed_at`, legacy drop |
| `supabase/queries/orders/fn_confirm_shipment_delivery.sql` | Modified | Delivered-only, Connect-aware |
| `supabase/queries/orders/fn_confirm_delivery.sql` | Removed | Legacy path retired |
| `apps/frontend` (hooks, order detail, cards, locales) | Modified | Gate, copy, routing |
| `packages/types` | Modified | Registry entry; types regenerated post-deploy |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Carrier never records `delivered` (pre-existing) | Medium | Document `track-shipments` dependency; verify at handoff |
| Migration/deploy ordering breaks live path | Medium | Apply migration before Edge Function deploy |
| Confirm vs auto-completion race | Medium | Row lock + state check; idempotent outcomes |
| Unvalidated Stripe/Envia semantics | Medium | Explicit uncertainty; sandbox validation pre-production |

## Rollback Plan

Remove new Edge Functions + cron; re-apply prior `fn_confirm_shipment_delivery.sql`/`fn_confirm_delivery.sql` sources from git; revert frontend. `buyer_confirmed_at` additive/nullable — keep. Rollback restores known defects; emergency-only.

## Dependencies

- `track-shipments`/Envia as canonical `delivered` source.
- Maintainer manual deployment (SQL order, Edge Function, cron); `bun db:types` only after confirmation.

## Success Criteria

- [ ] Confirm rejected from `shipped`, succeeds from `delivered`; retries idempotent.
- [ ] No wallet writes for Connect shipments; INFO audit present.
- [ ] Explicit confirm sets `buyer_confirmed_at`; auto-completion leaves it NULL with separate durable audit evidence.
- [ ] `fn_confirm_delivery` retired; no client fallback remains.
- [ ] Strict TDD focused suite green; unrelated baseline failures excluded.
- [ ] Handoff delivered; types regenerated after confirmation.
