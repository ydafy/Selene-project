CREATE OR REPLACE FUNCTION public.fn_record_closure_attempt (
  p_user_id       uuid,
  p_last_error    text,
  p_count_attempt boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  UPDATE public.account_closures
  SET attempts = attempts + CASE WHEN p_count_attempt THEN 1 ELSE 0 END,
      last_error = left(p_last_error, 500),
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) TO "service_role";

COMMENT ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) IS 'Service-only (SECURITY INVOKER): atomically adds one attempt (when p_count_attempt) and stamps last_error and updated_at on an account closure.';

REVOKE ALL ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) FROM PUBLIC, "anon", "authenticated";
