CREATE OR REPLACE FUNCTION public.fn_release_products (
  p_product_ids uuid[]
)
  RETURNS TABLE (
    success boolean
  )
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  PERFORM public.fn_release_listings(p_product_ids, true, false);

  RETURN QUERY SELECT true;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_release_products"(uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_release_products"(uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_products"(uuid[]) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_release_products"(uuid[]) FROM PUBLIC, "anon", "authenticated";
