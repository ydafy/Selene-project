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

COMMENT ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) IS 'cron-watchdog deletes the internal.ops_failures rows it reported to Sentry (odd/tasks/table-cleanup.md S6b). Returns the number of rows removed. service_role only.';

-- internal is not exposed through PostgREST, so cron-watchdog reaches the table
-- through this function. SECURITY INVOKER: service_role already holds DELETE on
-- internal.ops_failures, so the function adds no privilege. No client role may
-- execute it.
GRANT EXECUTE ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_delete_ops_failures"(bigint[]) FROM PUBLIC, "anon", "authenticated";
