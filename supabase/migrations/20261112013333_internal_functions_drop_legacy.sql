-- Drop two dead public functions (odd/tasks/internal-schema.md L7).
-- fn_apply_connect_account_actionability only raised ACCOUNT_REFRESH_REQUIRED;
-- the committed account refresh replaced it and no Edge Function calls it.
-- fn_release_stale_reservations had no caller; fn_reserve_products releases
-- expired reservations through fn_release_listings(ids, true, true), which stays.
-- Grant review: dropping a function removes its grants (service_role only);
-- no other grant changes.
SET local check_function_bodies = off;

DROP FUNCTION "public"."fn_apply_connect_account_actionability"(text, boolean, text, timestamp WITH time zone, boolean, text, text);

DROP FUNCTION "public"."fn_release_stale_reservations"(uuid[]);
