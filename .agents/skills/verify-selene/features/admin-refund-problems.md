# Admin refund problems

An admin sees shipment cancellations whose refund failed or was not found, and marks one resolved with an external payment reference. The shipment becomes `cancelled` and an audit row is written.

## Sub-features

- `list`: `list-shipment-refund-problems` returns failed and escalated refunds to admins only.
- `resolve`: `resolve-shipment-refund` records the resolution (`refund_resolved_at`, `refund_resolved_by`, `refund_resolution_reference`), cancels the shipment, and writes `admin_audit_logs` `SHIPMENT_REFUND_RESOLVED`.
- `deny`: buyer, anon, and no-auth callers are refused.

## How to get to it (user POV)

Admin signs in at `/login` (`admin@selene.local`), opens `/payments`, tab "Necesita atención", chip "Reembolsos". Each problem is an `article` with a "Marcar resuelto" button, then the field "Referencia del pago externo" and "Confirmar resolución".

## Driving it with Bruno and Playwright

Preconditions: stack running, fresh `supabase db reset` (no other refund problems).

- `deny`, from `bruno/`: `run auth/login-buyer.bru functions/resolve-shipment-refund-buyer.bru --env local` returns 403 `ADMIN_ONLY`. Also `functions/resolve-shipment-refund-no-auth.bru`, `-anon-key.bru`, `-invalid-shipment.bru`, `-unknown-shipment.bru`.
- `list`: `run functions/login-admin.bru functions/list-shipment-refund-problems-admin.bru --env local` returns 200 with `problems` array (empty on a fresh seed). Buyer and no-auth variants sit beside it.
- `list` + `resolve` end to end: `bun run test:e2e:local` runs `e2e/admin-web-local/refund-problems.local.e2e.ts`. It seeds two problems through the service role (shipments `e2e10000-...-0a1` failed, `...0a2` escalated), drives the UI, then asserts the operation row, the audit row, and shipment statuses. Observable proof: `1 passed`, and a DB read of `shipments where id::text like 'e2e10000%'` returns 0 rows afterwards.

## Gotchas

- The spec fails fast with `FUNCTIONS_NOT_SERVED` if the functions are unreachable; start `bun run functions:serve` and rerun.
- Other refund problems in the database change the expected counts (`Reembolsos (2)`): reset first.
- The spec removes its rows in `afterAll`, also on failure; still confirm with the DB read.
