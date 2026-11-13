CREATE OR REPLACE FUNCTION public.fn_get_connect_account_sync_state (
  p_stripe_account_id text,
  p_stripe_event_ids  text[]
)
  RETURNS TABLE (
    refresh_pending             boolean,
    is_actionable               boolean,
    current_external_account_id text,
    recorded_event_count        integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  IF p_stripe_account_id IS NULL OR btrim(p_stripe_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;
  RETURN QUERY
  SELECT
    caa.refresh_pending,
    caa.is_actionable,
    caa.current_external_account_id,
    (SELECT count(*)::integer
       FROM internal.connect_account_events cae
      WHERE cae.stripe_account_id = p_stripe_account_id
        AND cae.stripe_event_id = ANY (COALESCE(p_stripe_event_ids, ARRAY[]::text[])))
  FROM (SELECT 1) AS seed
  LEFT JOIN internal.connect_account_actionability caa
    ON caa.stripe_account_id = p_stripe_account_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_get_connect_account_sync_state"(text, text[]) TO "service_role";

COMMENT ON FUNCTION "public"."fn_get_connect_account_sync_state"(text, text[]) IS 'Read-only view of the account refresh for server tooling (#381): the raw refresh_pending bit, is_actionable and current bank of the projection (NULL without a row), and how many of the given Stripe event ids stripe-webhooks recorded for this account. The payout gate is fn_get_connect_account_actionability, not this.';

REVOKE ALL ON FUNCTION "public"."fn_get_connect_account_sync_state"(text, text[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_get_connect_account_sync_state"(text, text[]) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_get_connect_account_sync_state"(text, text[]) FROM PUBLIC, "anon", "authenticated";
