# Post-Purchase Investigation Context

## Why this exists

The post-purchase area appeared substantially complete after multi-seller checkout and Stripe Connect work.

End-to-end testing later exposed a sequence of patches and increasingly serious or related failures. The maintainer lost confidence in knowing which past change, current behavior, or reported issue is the root cause.

## What changed

Original single-seller and order assumptions evolved into a multi-seller model with seller-scoped shipments.

This may have affected fulfillment, cancellation, disputes, payout, and UI or admin behavior. It does not establish that any of these areas broke.

## Known context, not conclusions

Previous sessions mentioned Envia timeouts and configuration, SQL validation, reconciliation, quotes, deployment and type generation, and shipping-unit questions.

These are leads and evidence only. They are not confirmed defects, a complete inventory, chosen scope, or chosen fixes.

Existing code may be correct, incomplete, stale, or inconsistent. This context does not determine which, if any, applies.

## Areas that may be related

- Post-purchase fulfillment, including labels, tracking, provider communication, cron behavior, and UI.
- Cancellations and refunds.
- Disputes and returns.
- Escrow and seller payouts.

These are related areas, not an ordered work plan.

## Maintainer intent

Re-establish confidence from first principles before patching or deleting working code. Preserve what is verified as sound and change only what evidence supports.

Keep scope MVP++: reliable, safe with money, maintainable, and not over-engineered.

## Important boundary

This is context only. It intentionally makes no claim about root cause, implementation priority, technical design, remote deployment status, or production readiness.
