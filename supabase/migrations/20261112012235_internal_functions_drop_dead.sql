-- Drop two dead internal functions (#435, odd/tasks/internal-schema.md S6, T3).
-- No policy, view, function, Edge Function, Bruno request or test calls
-- internal.is_admin() or the one-argument internal.fn_check_order_access(uuid).
-- The (uuid, uuid) overload that the orders and order_items policies call stays.
-- Grant review: dropping a function removes its grants; no other grant changes.
SET local check_function_bodies = off;

DROP FUNCTION "internal"."fn_check_order_access"(uuid);

DROP FUNCTION "internal"."is_admin"();
