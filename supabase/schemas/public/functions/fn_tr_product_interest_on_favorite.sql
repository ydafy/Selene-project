CREATE OR REPLACE FUNCTION public.fn_tr_product_interest_on_favorite()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  -- The favorite is the buyer's own action and the seller notice is best
  -- effort: a failing notice rolls back only its own subtransaction.
  BEGIN
    PERFORM public.fn_notify_product_interest(NEW.product_id, NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'product.interest notice skipped for product %: %', NEW.product_id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_tr_product_interest_on_favorite"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_tr_product_interest_on_favorite"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_tr_product_interest_on_favorite"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_tr_product_interest_on_favorite"() FROM PUBLIC, "anon", "authenticated";
