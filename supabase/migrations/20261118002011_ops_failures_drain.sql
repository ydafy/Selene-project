SET local check_function_bodies = off;

-- odd/tasks/table-cleanup.md T6c (S6b). cron-watchdog reports each
-- internal.ops_failures row to Sentry and deletes the rows it reported. The
-- internal schema is not exposed through PostgREST, so it reaches the table
-- through two public functions: fn_list_ops_failures(p_limit) returns the
-- oldest rows (p_limit clamped to 1..100) and fn_delete_ops_failures(p_ids)
-- deletes exactly those ids and returns the count.
-- Grants: EXECUTE for service_role only (the watchdog's secret key); PUBLIC,
-- anon and authenticated get nothing, because failure context is server-only.
-- Both are SECURITY INVOKER with an empty search_path: service_role already
-- holds SELECT and DELETE on internal.ops_failures (T6a), so SECURITY DEFINER
-- would add privilege for no gain, and the table grants stay the one place
-- that says who may drain it.

CREATE OR REPLACE FUNCTION public.fn_delete_ops_failures (
  p_ids bigint[]
)
  RETURNS integer
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  -- Deletes exactly the given ids and returns how many rows it removed; a
  -- repeated, unknown or already deleted id removes nothing, so a retry is safe.
  WITH deleted AS (
    DELETE FROM internal.ops_failures AS f
    WHERE f.id = ANY (p_ids)
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM deleted;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_list_ops_failures (
  p_limit integer
)
  RETURNS TABLE (
    id          bigint,
    source      text,
    code        text,
    context     jsonb,
    occurred_at timestamp with time zone
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  -- The oldest failures first, at most 100 per call (a NULL limit lists 100).
  SELECT f.id, f.source, f.code, f.context, f.occurred_at
  FROM internal.ops_failures AS f
  ORDER BY f.occurred_at, f.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100));
$function$;

REVOKE ALL ON FUNCTION "public"."fn_list_ops_failures"(integer) FROM PUBLIC, "anon", "authenticated";

COMMENT ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) IS 'cron-watchdog deletes the internal.ops_failures rows it reported to Sentry (odd/tasks/table-cleanup.md S6b). Returns the number of rows removed. service_role only.';

COMMENT ON FUNCTION "public"."fn_list_ops_failures"(integer) IS 'cron-watchdog reads the oldest internal.ops_failures rows (p_limit clamped to 1..100) to report them to Sentry (odd/tasks/table-cleanup.md S6b). service_role only.';

REVOKE ALL ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_list_ops_failures"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_ops_failures"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_ops_failures"(integer) TO "service_role";
