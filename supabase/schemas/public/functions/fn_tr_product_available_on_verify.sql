CREATE OR REPLACE FUNCTION public.fn_tr_product_available_on_verify()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  PERFORM public.fn_notify_product_available(ARRAY[NEW.id]);
  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_tr_product_available_on_verify"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_tr_product_available_on_verify"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_tr_product_available_on_verify"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_tr_product_available_on_verify"() FROM PUBLIC, "anon", "authenticated";
