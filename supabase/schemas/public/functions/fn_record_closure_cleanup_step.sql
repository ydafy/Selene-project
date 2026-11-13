CREATE OR REPLACE FUNCTION public.fn_record_closure_cleanup_step (
  p_user_id uuid,
  p_step    text,
  p_state   text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_user_id IS NULL
     OR NOT (
       (p_step IN ('stripe_customer_cleanup', 'stripe_account_cleanup')
         AND p_state IN ('done', 'failed', 'not_needed'))
       OR (p_step = 'storage_cleanup' AND p_state IN ('done', 'failed'))
     ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  UPDATE internal.account_closures
  SET stripe_customer_cleanup = CASE WHEN p_step = 'stripe_customer_cleanup' THEN p_state ELSE stripe_customer_cleanup END,
      stripe_account_cleanup = CASE WHEN p_step = 'stripe_account_cleanup' THEN p_state ELSE stripe_account_cleanup END,
      storage_cleanup = CASE WHEN p_step = 'storage_cleanup' THEN p_state ELSE storage_cleanup END,
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) IS 'Service-only (SECURITY DEFINER): records the result of one cleanup step (Stripe customer, Stripe account or Storage) of an account closure and stamps updated_at. Does not count an attempt; an unknown user changes nothing.';

REVOKE ALL ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) FROM PUBLIC, "anon", "authenticated";
