CREATE OR REPLACE FUNCTION public.fn_get_location_by_zip (
  p_zip text
)
  RETURNS TABLE (
    state_code text,
    state_name text,
    city       text,
    districts  text[]
  )
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        m.state_code, 
        m.state_name, 
        m.city, 
        array_agg(m.district) as districts
    FROM public.mexico_zips m
    WHERE m.zip_code = p_zip
    GROUP BY m.state_code, m.state_name, m.city;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_get_location_by_zip"(text) TO "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."fn_get_location_by_zip"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_get_location_by_zip"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fn_get_location_by_zip"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_get_location_by_zip"(text) TO "postgres";
