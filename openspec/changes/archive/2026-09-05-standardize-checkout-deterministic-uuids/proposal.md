# Proposal: Standardize Checkout Deterministic UUIDs

## Intent

Problem statement: order-group/shipment IDs are raw SHA-256 digests formatted as UUIDs — version/variant bits are random hash bits, so most outputs violate RFC 4122. Strict consumers reject them: `confirm-shipment-delivery` Zod `.uuid()` + RFC regex fail confirmation with `INVALID_REQUEST` today.

Goal: canonical namespace-based UUID v5 (RFC 9562 §5.5 — SHA-1 of namespace UUID + name) preserving Stripe idempotency, one-shipment-per-product determinism, checkout-recovery bijection.

## Scope

### In Scope
- Rewrite `deriveOrderGroupId`/`deriveShipmentId` in `single-payment-builder.ts` to true UUID v5 (fixed namespace + existing name strings).
- Update byte-equality tests; assert version/variant + Zod acceptance.
- Contract tests: confirmation + settlement consumers accept producer IDs; PI params byte-stable on repeated inputs.
- Maintainer-run cutover runbook (redeploy, TRUNCATE, verification); no remote agent operations.

### Out of Scope
- Production backfill; loosening consumer validators; schema / `bun db:types`; Connect, Envia, disputes/refunds/cancellations; pipeline restructuring.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `single-modal-multiseller-checkout`: "Durable Per-Product Shipment Allocation" — deterministic IDs MUST become namespace-based UUID v5; add byte-stability + producer→consumer acceptance requirements.

## Approach

Pin a fixed namespace UUID; derive `v5(ns, "selene_order_group:<key>")` / `v5(ns, "selene_shipment:<key>:product:<productId>")` via a Deno-compatible v5 library (design selects). Rejected: calling a bit-patched SHA-256 digest "UUID v5". Legacy bytes change at cutover; the disposable-sandbox TRUNCATE absorbs it. Post-cutover, v5 purity keeps PaymentIntent params byte-stable for repeated inputs.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/create-connect-payment/single-payment-builder.ts` | Modified | derivation → UUID v5 |
| `supabase/functions/create-connect-payment/single-payment-builder.test.ts` | Modified | v5 fixtures; format+stability tests |
| `supabase/functions/confirm-shipment-delivery/confirm-shipment-delivery.test.ts` | Modified | Producer→confirmation contract test |
| `supabase/functions/stripe-webhooks/single-modal-settlement.test.ts` | Modified | Producer→settlement round-trip test |
| `openspec/specs/single-modal-multiseller-checkout/spec.md` | Modified | v5 format+stability requirements |

Read-only audit: confirmation/settlement functions, order/dispute SQL, types, frontends.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pre-cutover PIs lose idempotency reuse | Med | Sandbox TRUNCATE; retries stable by purity |
| v5 uses SHA-1, weaker than SHA-256 | Low | 122-bit variable payload + namespace isolation; infeasible |
| New v5 dependency in Edge Function | Low | Prefer Deno std; decide in design |
| Byte-equality fixture churn | Med | Strict TDD; update fixtures first |

## Rollback Plan

Revert producer+test commits: prior SHA-256 pipeline restored; no schema down-migration. Maintainer re-runs sandbox TRUNCATE.

## Dependencies

- Maintainer-run `create-connect-payment` redeploy + sandbox cleanup; no remote operation agent-authorized.

## Success Criteria

- [ ] Outputs are true UUID v5 (version `5`, variant `[89ab]`); pass Zod `.uuid()` + confirmation regex
- [ ] Contract tests: confirmation + settlement consumers accept producer IDs
- [ ] PI params byte-identical for repeated inputs post-cutover
- [ ] `bun test` green
- [ ] Sandbox smoke checkout→delivery→confirmation succeeds post-cutover
