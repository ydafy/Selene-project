CREATE OR REPLACE FUNCTION public.fn_unregister_push_token (
  p_token text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF p_token IS NULL
     OR char_length(p_token) > 255
     OR p_token !~ '^Expo(nent)?PushToken\[[^\]\s]+\]$' THEN
    RAISE EXCEPTION 'INVALID_PUSH_TOKEN';
  END IF;

  DELETE FROM public.push_tokens WHERE token = p_token;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_unregister_push_token"(text) TO "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_unregister_push_token"(text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_unregister_push_token"(text) IS 'Client RPC (SECURITY DEFINER, anon and authenticated): deletes the push token row with this exact token, whoever calls it. A missing token is a no-op; a malformed token raises INVALID_PUSH_TOKEN.';

REVOKE ALL ON FUNCTION "public"."fn_unregister_push_token"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fn_unregister_push_token"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_unregister_push_token"(text) TO "postgres";
