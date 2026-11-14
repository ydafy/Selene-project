# RLS performance and indexes

Roadmap #299, item 11 (#310). Worktree `supabase-health`, branch `feat/rls-performance-indexes` from `origin/main` `c249b89d`. One PR; one commit per task (C1-C6), each with its test first. Plan approved on 2026-11-13 (L3).

## Specs

- S1. From #310, done when: "The performance advisor shows no RLS or policy lint, and the pgTAP tests still pass."
- S2. Every policy calls `auth.uid()` and `is_admin()` as `(select auth.uid())` and `(select public.is_admin())` (`addresses`, `shipment_tracking_events`, `products`, `profiles`, `profiles_private`, `shipments`, `storage.objects`). `internal.fn_check_order_access` is `STABLE`.
- S3. One permissive policy per role and action: `shipments` SELECT (4 to 1), `products` SELECT and UPDATE (2 to 1 each), `profiles` SELECT (`admin_payments_select` dropped; `profiles_public_read` already returns every row). Who sees and changes which rows does not change; pgTAP per role (buyer, seller, admin, outsider) pins it before and after.
- S4. Admin checks in policies and in `internal.fn_check_order_access` go through `public.is_admin()`, one definition of admin for every policy. `is_admin()` gets a `search_path` that ends in `pg_temp`.
- S5. Indexes: the 8 foreign keys the advisor lists (`push_deliveries.user_id`, `reviews.order_id`, `shipment_cancellation_operations.order_id`, `shipment_completion_events.actor_id` and `.order_id`, `shipment_label_events.shipment_id`, `shipment_tracking_events.webhook_delivery_id`, `shipments.origin_address_id`), including the event tables #309 will merge (D2); the `notifications(user_id, read)` index #310 names when the app's queries use it; duplicate indexes covered by a unique index are dropped.
- S6. Policies on `public` tables name the roles that hold the grant (`TO authenticated`, or `TO anon, authenticated` where anon has one) instead of `TO PUBLIC` (D1).
- S7. A pgTAP guard fails when a policy in `public` or `storage` calls `auth.*()` or `is_admin()` without `select`, when a role and action have two permissive policies, when a foreign key in `public` or `internal` has no index whose leading columns cover it, or when a `public` policy targets `PUBLIC`.
- S8. Storage policies compare `products.id`, `orders.id` and `shipments.order_id` as uuid, not `id::text`, so the primary key or foreign key index applies; a folder name that is not a uuid is still denied, never an error (D3).
- S9. Out of scope: unused indexes (after real traffic, per #310); dropping tables #309 removes.

## Tasks

- T1 (S3) [done, commit: the `test(db)` per-role access commit] pgTAP per role for `addresses`, `shipments`, `products`, `profiles`, `orders`, `order_items` and `shipment_tracking_events`, green on today's policies. Commit C1.
- T2 (S2, S3, S7) [pending] Wrap the calls, merge the policies, `fn_check_order_access` STABLE; guard part 1 (initplan, multiple permissive). Commit C2.
- T3 (S4) [pending] Admin checks through `is_admin()`, suspended-admin cases, `is_admin()` search_path. Commit C3.
- T4 (S5, S7) [pending] Indexes and the foreign key guard. Commit C4.
- T5 (S6, S7) [pending] `TO PUBLIC` to explicit roles and its guard. Commit C5.
- T6 (S8) [pending] Storage policies compare uuids; `storage_access.test.sql` cases. Commit C6.
- T7 (S1) [pending] Types, schema check, full checks, local advisors, PR; remote advisors after the maintainer's green light for the push.

## Log

- L1. User request (2026-11-13): "Seguimos con el roadmap #299, ítem 11 (#310): RLS performance and indexes. Worktree supabase-health, rama nueva desde main actualizado (feat/money-integer-cents ya está mergeada). Antes de nada leé #299 y #310, y en Engram el último resumen de sesión. Investigá primero (políticas con auth.uid() sin select, funciones en políticas, FKs sin índice, advisors de performance del remoto) y proponeme el plan antes de escribir."
- L2. Investigation (explorer plus parent). Remote advisors 2026-11-14: 5 `auth_rls_initplan` (4 `addresses`, 1 `shipment_tracking_events`), 14 `multiple_permissive_policies` (`products`, `profiles`, `shipments`), 8 `unindexed_foreign_keys`, 20 `unused_index`. The repository also has unwrapped `is_admin()` in 9 policies, unwrapped `auth.uid()` in 3 avatar storage policies, a VOLATILE `fn_check_order_access` called per row, `id::text` comparisons in storage policies, two indexes that duplicate a unique index, and about 20 `TO PUBLIC` policies. No pgTAP covers per-role reads of `shipments`, `addresses` or `profiles`; `shipment_tracking.test.sql` pins the shape of its one policy. Two admin checks do not go through `is_admin()` (details with the maintainer).
- L3. Maintainer approved the plan and the recommended options D1 (all `TO PUBLIC` policies), D2 (index the event tables now), D3 (storage uuid comparison as C6) and the admin-check change in C3: "okey me gusto todo master, luz vrede a todo."
- L4. T1 evidence (worker in place). `supabase/tests/database/rls_client_access.test.sql`, plan(49), users 14001-14006: per-role reads and writes on `addresses`, `shipments`, `orders`, `order_items`, `products`, `profiles`, `profiles_private` and `shipment_tracking_events`, green on today's policies. `bun run test:db` 72 files, 2617 PASS. Mutation: removing `is_admin()` from `addresses_select_policy` fails test 34; `supabase db reset` restores green. A single test file that includes `money.psql` runs with `supabase test db <file> supabase/tests/fixtures/money.psql` (pg_prove then exits 255 on the fixture).
