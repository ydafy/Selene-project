# fn_release_products authorization (block B1)

Close the hole where any signed-in user can release any RESERVED product, without breaking the server-side release paths.
Design A now (server-only RPC, no direct client calls); design B (ownership-bound reservations) recorded for later.

## Specs

- S1: "Después de eso arrancamos con fn_release_products (bloque B)." Finding being fixed (supabase-dev-workflow L10): "`fn_release_products` lets any signed-in user release any reserved product". After the change, `anon` and `authenticated` cannot execute `public.fn_release_products(uuid[])`; only `service_role` can.
- S2: Maintainer chose "A ahora, B después": "Revoco authenticated, saco las llamadas directas del cliente y la salida de pantalla usa rollback-connect-payment." Server-side callers (`create-connect-payment`, `rollback-connect-payment`, `stripe-webhooks`) keep releasing RESERVED products with the service role.
- S3: The frontend no longer calls `fn_release_products`. Leaving the payment screen unpaid goes through `rollback-connect-payment` (which checks `metadata.buyer_id` against the caller); a failed reservation (`RESERVATION_FAILED`) releases nothing from the client, because `fn_reserve_products` already rolls back its own work.
- S4: The canonical `supabase/queries/products/fn_release_products.sql` and a new migration match each other; the migration is proven on the local stack with `supabase db reset`.
- S5 (later, design B): "Nueva tabla product_reservations(product_id, buyer_id) y el RPC libera solo lo tuyo." Plus the rollback gap: a late rollback by buyer A can release buyer B's newer reservation of the same product. Not in this change.

## Tasks

- [x] T0 (S1, S2): reproduced on the local stack (L4).
- [x] T1 (S1, S2, S4; worker): migration `20261020214153_release_products_service_role_only.sql`, canonical header, structural test. Evidence L5.
- [ ] T2 (S3): frontend: remove direct RPC calls; unmount path uses rollback; tests.
- [ ] T3: report SQL apply order and deploy steps to maintainer; advisors after apply.
- [ ] T4 (S5): design B, deferred.

## Log

- L1: "Después de eso arrancamos con fn_release_products (bloque B). Commits acotados, como siempre."
- L2: Exploration (2026-10-20): deployed function is SECURITY DEFINER, `authenticated` EXECUTE, only checks that JWT `sub` exists (MCP: `auth_exec = true`). Repo canonical file says service_role only and SECURITY INVOKER (archived migration 20260701000000 never matched remote). Reserving buyer is not stored in the database (only in Stripe PI metadata `buyer_id`). Reservation is `fn_reserve_products` (service_role only, called by `create-connect-payment`). Client callers: `apps/frontend/app/checkout/payment.tsx:65-78` (unmount), `apps/frontend/core/hooks/usePaymentProcess.ts:92` (used at :128, :181, :184, :223). `usePaymentProcess.ts:180-181` releases the whole cart on `RESERVATION_FAILED`, including products another buyer holds. `rollback-connect-payment` verifies `metadata.buyer_id === user.id` and is already called at `usePaymentProcess.ts:106`. Cron `purge-expired-reservations` (`*/15`, as postgres) releases RESERVED older than 30 minutes; `fn_reserve_products` reclaims rows older than 10 minutes. `reservation_lifecycle_hardening.test.ts` reads only the archived migration, which is why the drift went unnoticed. No worktree modifies these files.
- L3: Maintainer chose "A ahora, B después".
- L5: T1 evidence. RED: `Expected exactly one *_release_products_service_role_only.sql, found 0`; GREEN 10/10, `bun test supabase/migrations supabase/queries` 455/455. Fresh `supabase start` applied baseline + later migrations + the new one + seed (equivalent to a reset). REST on product `...0b1`: service_role on RESERVED -> 200 `[{"success":true}]`, VERIFIED; buyer JWT -> 403 `{"code":"42501",...,"message":"permission denied for function fn_release_products"}`, stays RESERVED; anon -> 401 same 42501, stays RESERVED; service_role on VERIFIED -> 200, unchanged (idempotent); service_role on SOLD -> 200, stays SOLD.
- L4: T0 evidence, local stack on main (baseline = deployed body), REST calls on seeded product `00000000-0000-4000-8000-0000000000b1` set RESERVED by service role: service_role RPC -> `{"code":"P0001","message":"UNAUTHORIZED_NO_SESSION"}`, product stays RESERVED (every server-side release fails: the service-role JWT has no `sub`); `buyer@selene.local` (not the reserver) RPC -> `[{"success":true}]`, product becomes VERIFIED (the hole); anon RPC -> `UNAUTHORIZED_NO_SESSION`, stays RESERVED (locally anon reaches the body; remote `anon_exec = false`). Today releases only work through the client fallback with the user JWT (e.g. `usePaymentProcess.ts:128` after rollback). Deploy order: SQL first, frontend second. No remote logs in the last 24 h mention the error (no traffic).
