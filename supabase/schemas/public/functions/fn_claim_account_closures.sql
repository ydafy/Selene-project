CREATE OR REPLACE FUNCTION public.fn_claim_account_closures (
  p_limit        integer,
  p_min_idle     interval,
  p_max_attempts integer
)
  RETURNS SETOF public.account_closures
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_min_idle IS NULL OR p_min_idle < interval '0'
     OR p_max_attempts IS NULL OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  RETURN QUERY
  UPDATE public.account_closures AS c
  SET attempts = c.attempts + 1,
      updated_at = now()
  WHERE c.user_id IN (
    SELECT a.user_id
    FROM public.account_closures AS a
    WHERE (
        a.stripe_customer_cleanup IN ('pending', 'failed')
        OR a.stripe_account_cleanup IN ('pending', 'failed')
        OR a.storage_cleanup IN ('pending', 'failed')
      )
      AND a.attempts < p_max_attempts
      AND a.updated_at <= now() - p_min_idle
    ORDER BY a.updated_at, a.user_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING c.*;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) IS 'Service-only (SECURITY INVOKER): atomically claims up to p_limit closures with an open cleanup step, oldest first, adding one attempt each. Skips rows touched within p_min_idle and rows at p_max_attempts.';

REVOKE ALL ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) FROM PUBLIC, "anon", "authenticated";
