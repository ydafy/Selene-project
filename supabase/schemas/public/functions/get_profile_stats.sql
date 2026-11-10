CREATE OR REPLACE FUNCTION public.get_profile_stats (
  target_user_id uuid
)
  RETURNS json
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  total_sold integer;
  avg_rating numeric;
  total_reviews integer;
begin
  -- Contar ventas (Productos con status 'SOLD'), via the public view
  select count(*) into total_sold
  from public.products_public
  where seller_id = target_user_id and status = 'SOLD';

  -- Calcular rating promedio y conteo
  select avg(rating), count(*) into avg_rating, total_reviews
  from public.reviews
  where seller_id = target_user_id;

  -- Devolver objeto JSON
  return json_build_object(
    'sales_count', total_sold,
    'rating_average', coalesce(avg_rating, 0), -- Si es null, devuelve 0
    'reviews_count', total_reviews
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_profile_stats"(uuid) TO "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_profile_stats"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_profile_stats"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."get_profile_stats"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_profile_stats"(uuid) TO "postgres";
