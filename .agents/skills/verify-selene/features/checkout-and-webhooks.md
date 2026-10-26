# Checkout and Stripe webhooks

A buyer pays for verified listings through Stripe Connect; Stripe events reach `stripe-webhooks`, which updates orders and shipments.

## Sub-features

- `guards`: `create-connect-payment` rejects oversized `productIds`, listings that are not reservable, and sellers pending onboarding.
- `recovery-lease`: the checkout recovery lease RPCs are service-role only and exclusive.
- `webhook-signature`: `stripe-webhooks` refuses unsigned calls before touching data.
- `webhook-events`: forwarded sandbox events update local rows (events in `STRIPE_WEBHOOK_EVENTS`, `scripts/stripe-listen.ts`).

## How to get to it (user POV)

Buyer opens a listing, goes to checkout, pays by card or SPEI. Stripe then calls the webhook. There is no admin-web screen for this flow.

## Driving it with Bruno and Stripe CLI

Preconditions: stack running, fresh seed, functions reachable.

- `guards`: `run auth/login-buyer.bru functions/checkout-oversized-product-ids.bru products/checkout-in-review-refused.bru products/checkout-in-review-unchanged.bru --env local`. In review listing `...0b6` returns 409 `RESERVATION_FAILED`, and stays unchanged. `functions/checkout-seller-onboarding-pending.bru` and `-pending-released.bru` run as a pair, in that order.
- `recovery-lease`: `functions/checkout-recovery-lease-service-acquire.bru`, `-service-held.bru`, `-release-holder.bru`, `-release-not-holder.bru`, plus `-anon-denied` and `-buyer-denied`. Run as one invocation in that order.
- `webhook-signature`: `run functions/stripe-webhooks-unsigned.bru --env local` returns 400 `No signature`.
- `webhook-events`: `bun run stripe:listen` in the background, then `stripe trigger payment_intent.succeeded`. Read the resulting rows with `supabase db query --local`, the event in the sandbox through the Stripe MCP (`livemode: false`), and Edge Function logs through the Supabase MCP only if the failure needs it.

## Gotchas

- Not yet proven (`webhook-events`): a triggered Stripe event carries Stripe-generated objects with no matching local order, so a handler that needs an existing order logs and ignores it. A real paid flow needs an order created first; the seed has none for this. If the first real run shows this, report the precondition gap instead of weakening the check.
- Not yet proven: `stripe:listen` needs a prior `stripe login` and a webhook secret in `supabase/functions/.env` that matches the listener's signing secret; both are maintainer-owned.
- Payment-flow changes also need `selene-engineering-principles`.
