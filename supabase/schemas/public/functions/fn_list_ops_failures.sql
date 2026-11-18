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

COMMENT ON FUNCTION "public"."fn_list_ops_failures"(integer) IS 'cron-watchdog reads the oldest internal.ops_failures rows (p_limit clamped to 1..100) to report them to Sentry (odd/tasks/table-cleanup.md S6b). service_role only.';

-- internal is not exposed through PostgREST, so cron-watchdog reaches the table
-- through this function. SECURITY INVOKER: service_role already holds SELECT on
-- internal.ops_failures, so the function adds no privilege. No client role may
-- execute it: failure context is server-only.
GRANT EXECUTE ON FUNCTION "public"."fn_list_ops_failures"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_list_ops_failures"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_ops_failures"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_ops_failures"(integer) FROM PUBLIC, "anon", "authenticated";
