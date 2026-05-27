
declare
  total_sold integer;
  avg_rating numeric;
  total_reviews integer;
begin
  -- Contar ventas (Productos con status 'SOLD')
  select count(*) into total_sold
  from public.products
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
