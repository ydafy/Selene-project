CREATE OR REPLACE FUNCTION public.check_max_payment_methods()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  -- Solo contamos las tarjetas activas (donde deleted_at es nulo)
  IF (SELECT COUNT(*) FROM public.payment_methods WHERE user_id = NEW.user_id AND deleted_at IS NULL) >= 3 THEN
    RAISE EXCEPTION 'PAYMENT_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."check_max_payment_methods"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_max_payment_methods"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_max_payment_methods"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."check_max_payment_methods"() FROM PUBLIC, "anon", "authenticated";
