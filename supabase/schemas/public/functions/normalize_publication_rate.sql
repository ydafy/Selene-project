CREATE OR REPLACE FUNCTION public.normalize_publication_rate (
  p_rate numeric
)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'public'
  AS $function$
  SELECT CASE
    WHEN p_rate IS NULL OR p_rate < 0 THEN NULL
    WHEN p_rate <= 1 THEN p_rate
    WHEN p_rate <= 100 THEN p_rate / 100
    ELSE p_rate / 10000
  END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."normalize_publication_rate"(numeric) TO "service_role";

REVOKE ALL ON FUNCTION "public"."normalize_publication_rate"(numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_publication_rate"(numeric) TO "postgres";

REVOKE ALL ON FUNCTION "public"."normalize_publication_rate"(numeric) FROM PUBLIC, "anon", "authenticated";
