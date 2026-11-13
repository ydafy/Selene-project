CREATE OR REPLACE FUNCTION public.fn_list_capped_account_closures (
  p_max_attempts integer,
  p_limit        integer
)
  RETURNS TABLE (
    user_id  uuid,
    attempts integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_max_attempts IS NULL OR p_max_attempts < 1
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  RETURN QUERY
  SELECT a.user_id, a.attempts
  FROM internal.account_closures AS a
  WHERE (
      a.stripe_customer_cleanup IN ('pending', 'failed')
      OR a.stripe_account_cleanup IN ('pending', 'failed')
      OR a.storage_cleanup IN ('pending', 'failed')
    )
    AND a.attempts >= p_max_attempts
  ORDER BY a.updated_at, a.user_id
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) IS 'Service-only (SECURITY DEFINER): lists up to p_limit closures with an open cleanup step and at least p_max_attempts attempts, oldest first, for the retry worker to report.';

REVOKE ALL ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) FROM PUBLIC, "anon", "authenticated";
