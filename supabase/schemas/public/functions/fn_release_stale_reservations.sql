CREATE OR REPLACE FUNCTION public.fn_release_stale_reservations (
  p_product_ids uuid[] DEFAULT '{}'::uuid[]
)
  RETURNS TABLE (
    released_id uuid
  )
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT COALESCE(array_agg(s.id), '{}')
    INTO v_ids
  FROM public.products s
  WHERE s.status = 'RESERVED'
    AND s.reserved_at < now() - interval '10 minutes'
    AND (p_product_ids = '{}' OR s.id = ANY(p_product_ids));

  RETURN QUERY
  SELECT * FROM public.fn_release_listings(v_ids, true, true);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_release_stale_reservations"(uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_release_stale_reservations"(uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_release_stale_reservations"(uuid[]) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_release_stale_reservations"(uuid[]) FROM PUBLIC, "anon", "authenticated";
