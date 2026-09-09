# Delta for shipments

## MODIFIED Requirements

### Requirement: Shipment Frontend Permissions

`EnrichedShipment.permissions.canConfirmDelivery` SHALL be `isBuyer && status === 'delivered' && !activeDispute`. Confirmation copy SHALL state confirmation is post-delivery only and payout is admin-released.

(Previously: `canConfirmDelivery` was `buyer + status in ('shipped','delivered')` with no dispute qualification and misleading copy.)

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Gate after delivery | delivered shipment, no active dispute | permissions compute | `canConfirmDelivery` is true |

## ADDED Requirements

### Requirement: Confirmation Edge Function Boundary and Authorization

Confirmation MUST route through the `confirm-shipment-delivery` Edge Function calling `fn_confirm_shipment_delivery` with service role. The RPC SHALL reject direct authenticated calls. The Edge Function SHALL verify buyer ownership, shipment isolation, and maintenance mode before mutation.

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Successful confirmation | delivered shipment, caller is buyer | app invokes Edge Function | shipment becomes `completed`, success returned |

### Requirement: Delivered-Only and Dispute Gate

The system SHALL allow buyer confirmation only from `status = 'delivered'` and SHALL reject active disputes. Post-dispute reconfirmation is excluded.

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Confirm from delivered | `status = 'delivered'`, buyer authorized | buyer confirms | shipment becomes `completed` |

### Requirement: Connect Guard on Confirmation

For Connect shipments (`stripe_payment_intent_id IS NOT NULL`), the system MUST skip `wallets`/`wallet_transactions` writes, log an INFO audit event, and still transition to `completed`.

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Connect shipment | delivered Connect shipment | buyer confirms | no wallet mutation, INFO audit written, shipment completes |

### Requirement: Completion Semantics, Audit Source, and Idempotency

The system SHALL set `buyer_confirmed_at` only on explicit confirmation. The scheduled function SHALL auto-complete delivered shipments 48 hours after `delivered_at` when `buyer_confirmed_at IS NULL`, leaving it NULL. Every completion MUST log a durable audit event tagged `buyer` or `auto`; concurrent completions MUST be idempotent.

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Manual completion | delivered shipment | buyer explicitly confirms | `buyer_confirmed_at` set, audit source `buyer` |
| Automatic completion | `delivered_at < now() - 48h`, `buyer_confirmed_at IS NULL` | scheduled function runs | shipment completes, `buyer_confirmed_at` NULL, audit source `auto` |

### Requirement: Legacy Path Retirement and Order Side Effects

The system MUST drop `fn_confirm_delivery` and its frontend fallback. Order status MUST keep deriving through the existing trigger, and completed shipments MUST remain visible to the existing admin payout release view.

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Legacy and payout | any authenticated session; completed Connect shipment with allocation and `transfer_group` | legacy function invoked or admin queue queried | legacy call errors, no mutation; shipment appears eligible for release |

### Requirement: Deployment and Provider Validation Boundary

The migration MUST run before the Edge Function deploy; types MUST regenerate only after remote SQL confirmation. Envia and Stripe semantics remain unvalidated; sandbox/manual verification MUST precede go-live.

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Deploy and validate | change ready for release, sandbox validation incomplete | maintainer follows handoff or considers release | migration first, Edge Function second, `bun db:types` after SQL confirmation; release blocked until validation complete |

## Acceptance Criteria

- Buyer confirm is rejected from `shipped`, succeeds from `delivered`, and retries are idempotent.
- Connect shipments complete without wallet writes and log an INFO audit event.
- Explicit confirm sets `buyer_confirmed_at`; automatic 48h completion leaves it NULL with a distinct audit source.
- `fn_confirm_delivery` is retired and no frontend fallback remains.
- `canConfirmDelivery` is gated to `delivered` only with updated copy.
- Migration deploys before the Edge Function; types regenerate after SQL confirmation.

## REMOVED Requirements

### Requirement: Order-Level Buyer Confirmation Fallback

(Reason: `fn_confirm_delivery` duplicates shipment-scoped behavior, mutates deprecated wallet tables, and lacks a Connect guard.)
(Migration: Remove the `useOrderActions.confirmDelivery` fallback branch; route confirmations through `confirm-shipment-delivery`.)