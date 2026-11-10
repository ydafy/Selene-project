CREATE OR REPLACE FUNCTION public.fn_tr_product_available_on_connect_complete()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  PERFORM public.fn_notify_product_available(
    ARRAY(
      SELECT p.id
      FROM public.products p
      WHERE p.seller_id = NEW.id
        AND p.status = 'VERIFIED'
        AND p.deleted_at IS NULL
    )
  );
  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_tr_product_available_on_connect_complete"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_tr_product_available_on_connect_complete"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_tr_product_available_on_connect_complete"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_tr_product_available_on_connect_complete"() FROM PUBLIC, "anon", "authenticated";
