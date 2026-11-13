CREATE OR REPLACE FUNCTION public.fn_claim_account_closures (
  p_limit        integer,
  p_min_idle     interval,
  p_max_attempts integer
)
  RETURNS TABLE (
    user_id                 uuid,
    closed_at               timestamp with time zone,
    stripe_customer_id      text,
    stripe_account_id       text,
    stripe_customer_cleanup text,
    stripe_account_cleanup  text,
    storage_cleanup         text,
    attempts                integer,
    last_error              text,
    updated_at              timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
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
  UPDATE internal.account_closures AS c
  SET attempts = c.attempts + 1,
      updated_at = now()
  WHERE c.user_id IN (
    SELECT a.user_id
    FROM internal.account_closures AS a
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
  RETURNING c.user_id, c.closed_at, c.stripe_customer_id, c.stripe_account_id,
    c.stripe_customer_cleanup, c.stripe_account_cleanup, c.storage_cleanup,
    c.attempts, c.last_error, c.updated_at;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) IS 'Service-only (SECURITY DEFINER): atomically claims up to p_limit closures with an open cleanup step, oldest first, adding one attempt each. Skips rows touched within p_min_idle and rows at p_max_attempts.';

REVOKE ALL ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) FROM PUBLIC, "anon", "authenticated";
