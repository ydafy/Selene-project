CREATE OR REPLACE FUNCTION public.fn_purge_push_deliveries (
  p_limit integer
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'INVALID_PUSH_PURGE_LIMIT';
  END IF;

  WITH doomed AS (
    SELECT d.id
    FROM public.push_deliveries d
    WHERE d.status IN ('sent', 'failed', 'skipped')
      AND d.updated_at < now() - interval '30 days'
    ORDER BY d.updated_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.push_deliveries d
  USING doomed
  WHERE d.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_purge_push_deliveries"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_purge_push_deliveries"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_purge_push_deliveries"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_purge_push_deliveries"(integer) FROM PUBLIC, "anon", "authenticated";
