# Proposal: Public Profile Production Audit

## Intent

Harden the public seller profile so trust signals stay production-safe. This change fixes misleading public-profile behavior around review verification, stale reads, owner moderation actions, and error/empty states without expanding into the broader orders/multi-seller repair.

## Scope

### In Scope
- Define public seller profile behavior for owner view, active/verified listings only, route/type guards, retryable failures, review dates, and a11y/i18n cleanup.
- Define durable review display rules: profile reads reviews by `seller_id`; verified-purchase badge requires valid `shipment_id + product_id`; legacy unlinked reviews remain visible without badge; rating-only reviews affect aggregates but do not render cards.
- Define safe cache consistency requirements and document the review-creation handoff to the orders/shipment fix.

### Out of Scope
- Review sorting/filtering, redirecting owners to private profile, or exposing sold/unverified inventory.
- Broader orders/multi-seller remediation beyond minimal contract-safe work already supported by schema/types.

## Capabilities

### New Capabilities
- `public-seller-profile`: public seller profile states, visibility rules, trust signals, and review/listing presentation.

### Modified Capabilities
- `shipments`: clarify review eligibility/identity around shipment-safe verified purchases and the dependency on product-within-shipment review creation.

## Approach

Define the trust contract first, then harden UI behavior. Keep reads on current public data sources, hide report/block for the profile owner, preserve active/verified listings only, distinguish load errors from empty states, show review creation date when available, and require explicit accessibility/localization coverage. Do not ship fragile attribution fallbacks such as `order.items[0]`; instead, record the review-creation handoff as a follow-up once the orders bug is fixed.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/public-seller-profile/spec.md` | New | Source-of-truth for public profile behavior |
| `openspec/specs/shipments/spec.md` | Modified | Review eligibility and verified-purchase contract |
| `apps/frontend/app/profile/[id].tsx` | Modified | Route guard, owner actions, error/empty states |
| `apps/frontend/core/hooks/useSellerReviews.ts` | Modified | Review query semantics and display DTO |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Historical reviews lose verified badge coverage | Med | Keep legacy reviews visible; badge only linked reviews |
| Orders bug blocks full review creation wiring | High | Make follow-up dependency explicit; avoid temporary attribution hacks |

## Rollback Plan

Revert public-profile behavior/spec changes to the prior public read model, remove new verified/date/error-state requirements, and keep historical review rows untouched.

## Dependencies

- Existing schema/type support for `reviews.shipment_id`, `reviews.product_id`, and `reviews.created_at`.
- Follow-up: finish product-within-shipment review creation after the separate orders/multi-seller bug is fixed.

## Success Criteria

- [ ] Public seller profiles never show false verified-purchase badges and still preserve historical review aggregates.
- [ ] Owner views hide report/block actions, and products/reviews failures render explicit retryable error states instead of empty states.
- [ ] Proposal/spec follow-up clearly preserves the target review model: one review per `(reviewer_id, shipment_id, product_id)` with seller reads by `seller_id`.
