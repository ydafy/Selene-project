CREATE OR REPLACE FUNCTION public.fn_release_listings (
  p_product_ids   uuid[],
  p_only_reserved boolean,
  p_only_expired  boolean
)
  RETURNS SETOF uuid
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  PERFORM 1
  FROM public.profiles_private pp
  WHERE pp.id IN (
    SELECT s.seller_id
    FROM public.products s
    WHERE s.id = ANY(p_product_ids)
      AND (NOT p_only_reserved OR s.status = 'RESERVED')
      AND (NOT p_only_expired OR s.reserved_at < now() - interval '10 minutes')
  )
  ORDER BY pp.id
  FOR SHARE;

  RETURN QUERY
  UPDATE public.products AS p
  SET status = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN 'VERIFIED'::public.product_status_enum
        ELSE 'HIDDEN'::public.product_status_enum
      END,
      status_before_account_hold = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN p.status_before_account_hold
        ELSE COALESCE(p.status_before_account_hold, 'VERIFIED'::public.product_status_enum)
      END,
      updated_at = now(),
      reserved_at = NULL
  FROM public.products AS s
  LEFT JOIN public.profiles_private AS pp ON pp.id = s.seller_id
  WHERE s.id = p.id
    AND p.id = ANY(p_product_ids)
    AND (NOT p_only_reserved OR p.status = 'RESERVED')
    AND (NOT p_only_expired OR p.reserved_at < now() - interval '10 minutes')
  RETURNING p.id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_release_listings"(uuid[], boolean, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_release_listings"(uuid[], boolean, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_listings"(uuid[], boolean, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_release_listings"(uuid[], boolean, boolean) FROM PUBLIC, "anon", "authenticated";
