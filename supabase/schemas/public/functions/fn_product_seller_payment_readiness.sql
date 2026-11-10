CREATE OR REPLACE FUNCTION public.fn_product_seller_payment_readiness (
  p_product_ids uuid[]
)
  RETURNS TABLE (
    product_id              uuid,
    seller_accepts_payments boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  SELECT
    p.id,
    COALESCE(
      pp.stripe_account_id IS NOT NULL
        AND pp.stripe_onboarding_status = 'complete'
        AND pp.status IS DISTINCT FROM 'suspended'
        AND pp.status IS DISTINCT FROM 'banned',
      false
    )
  FROM public.products p
  LEFT JOIN public.profiles_private pp ON pp.id = p.seller_id
  WHERE p.id = ANY(p_product_ids[1:50])
    AND p.status = 'VERIFIED'
    AND p.deleted_at IS NULL;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_product_seller_payment_readiness"(uuid[]) TO "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_product_seller_payment_readiness"(uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_product_seller_payment_readiness"(uuid[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fn_product_seller_payment_readiness"(uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_product_seller_payment_readiness"(uuid[]) TO "postgres";
