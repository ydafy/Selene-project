## Summary

What changed and why, in a few lines.

## Issue

Closes #

## Verification

Tick what applies and paste the results.

- [ ] SQL, migrations, RPCs, RLS, grants: `supabase db reset` and each role called through Bruno
- [ ] Edge Function: `bun run functions:serve`, `bun run api:test`, request added in `bruno/`
- [ ] Payments or Stripe webhooks: the above plus `stripe:listen`, `stripe trigger`, result read in the sandbox
- [ ] Shipment transfer or cancellation: the above plus TLC in `docs/formal/shipment-transfer-cancellation/`
- [ ] Production bug: Sentry and Supabase logs checked, reproduced locally
- [ ] Dependencies: `bun audit` command from AGENTS.md
- [ ] Frontend only: `bun test` and typecheck of the touched files
- [ ] Admin-web screen: Playwright spec in `e2e/admin-web/` (`bun run test:e2e`, and `test:e2e:local` for endpoint changes)

## Risk

Money, SQL, RLS, auth, or webhooks touched? Say which and how it was proven.
