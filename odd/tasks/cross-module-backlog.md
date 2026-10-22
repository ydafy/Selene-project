# Backlog: follow-ups found outside the current module

Items found while working on a feature that belong to another module or to later hardening. Not started. Each entry names where it came from; promote an item to its own `odd/tasks/<feature>.md` before working on it.

## Specs

- S1 (maintainer, verbatim): "rceuerda que simepr puedes aanotar cosas en un tipo backlog para lo que se sale del modulo pero deveriamos de checar depues."

## Items

- BL1 | payouts | Payout runs in `manual_review`, `canceled` or `reconciliation_needed` show in admin Payments "Necesita atención" with no action, so they never leave the tab. Needs a way to close them after the admin fixes them in the Stripe Dashboard (resolve with reference, audited), like `resolve-shipment-refund`. Source: shipment-cancellations-b2 L33.
- BL2 | security | Several functions only revoke `PUBLIC`; local default privileges also grant `anon`/`authenticated` (`fn_cancel_shipment` locally). Remote is correct today. Add explicit `REVOKE ... FROM anon, authenticated` in a later migration so local and remote match. Source: shipment-cancellations-b2 L29 (1), review R1-fn-cancel-acl-public-only.
- BL3 | security | `get_advisors`: `is_admin()` is executable by `anon`, and 12 SECURITY DEFINER functions by `authenticated` (pre-existing, mostly admin RPCs that check `is_admin()` inside). Review which grants are intended. Source: shipment-cancellations-b2 L31.
- BL4 | security | `get_advisors`: leaked password protection is disabled in Supabase Auth; `pg_net` lives in `public`. Dashboard/infra decision. Source: shipment-cancellations-b2 L31.
- BL5 | orders | `cancel-order` top-level catch returns `error.message` with 400 for non-`ApiError` errors (no provider text reaches it today). Source: shipment-cancellations-b2 L23 (A1).
- BL6 | webhooks | A refund carrying our `shipment_id` that does not match the frozen request raises, so `stripe-webhooks` returns 500 and Stripe retries for ~3 days (DLQ row and Sentry event each time). Only a hand-made Dashboard refund can cause it. Consider a terminal `mismatch` outcome with one CRITICAL. Source: shipment-cancellations-b2 L27 (1).
- BL7 | webhooks | The refund-failure CRITICAL is sent after the RPC commits; a crash in between loses the alert (the buyer notice and the admin bucket still show it). Source: shipment-cancellations-b2 L27 (2).
- BL8 | admin | `resolve-shipment-refund` trims all whitespace and counts UTF-16 units; SQL `btrim` strips spaces and counts code points. Align both. Source: review R3-reference-length-unit-mismatch.
- BL9 | dev tooling | `deno check stripe-webhooks/index.ts` has 26 pre-existing TS18046 (`event` is unknown); `create-connect-payment` has TS2345 at `index.ts:160:68`. Source: shipment-cancellations-b2 L20, L27.
