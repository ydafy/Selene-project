CREATE OR REPLACE FUNCTION public.fn_apply_connect_account_actionability (
  p_stripe_account_id       text,
  p_is_actionable           boolean,
  p_blocked_reason          text,
  p_stripe_created          timestamp with time zone,
  p_payouts_enabled         boolean                  DEFAULT NULL::boolean,
  p_external_account_status text                     DEFAULT NULL::text,
  p_source_event_id         text                     DEFAULT NULL::text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  RAISE EXCEPTION 'ACCOUNT_REFRESH_REQUIRED';
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_apply_connect_account_actionability"(text, boolean, text, timestamp WITH time zone, boolean, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_apply_connect_account_actionability"(text, boolean, text, timestamp with time zone, boolean, text, text) IS 'Legacy event-time projection fenced with ACCOUNT_REFRESH_REQUIRED. Use separately committed acquire, authoritative paginated retrieval, and current-generation commit; never enable from signed historic bank state.';

REVOKE ALL ON FUNCTION "public"."fn_apply_connect_account_actionability"(text, boolean, text, timestamp WITH time zone, boolean, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_apply_connect_account_actionability"(text, boolean, text, timestamp WITH time zone, boolean, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_apply_connect_account_actionability"(text, boolean, text, timestamp WITH time zone, boolean, text, text) FROM PUBLIC, "anon", "authenticated";
