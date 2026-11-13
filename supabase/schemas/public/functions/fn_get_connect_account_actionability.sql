CREATE OR REPLACE FUNCTION public.fn_get_connect_account_actionability (
  p_stripe_account_id text
)
  RETURNS TABLE (
    is_actionable  boolean,
    blocked_reason text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  IF p_stripe_account_id IS NULL OR btrim(p_stripe_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;
  RETURN QUERY
  SELECT
    CASE WHEN caa.refresh_pending THEN FALSE
      ELSE COALESCE(caa.is_actionable, TRUE) END,
    CASE WHEN caa.refresh_pending THEN 'account_refresh_pending'::TEXT
      ELSE caa.blocked_reason END
  FROM (SELECT 1) AS seed
  LEFT JOIN internal.connect_account_actionability caa
    ON caa.stripe_account_id = p_stripe_account_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_get_connect_account_actionability"(text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_get_connect_account_actionability"(text) IS 'RPC-only payout gate, pending refresh returns FALSE/account_refresh_pending, including after retrieval error. Existing no-row TRUE compatibility is preserved; existing blocked rows are never bulk-enabled.';

REVOKE ALL ON FUNCTION "public"."fn_get_connect_account_actionability"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_get_connect_account_actionability"(text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_get_connect_account_actionability"(text) FROM PUBLIC, "anon", "authenticated";
