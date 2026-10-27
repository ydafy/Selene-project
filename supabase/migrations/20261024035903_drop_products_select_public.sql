-- Close the products table to non-owners (T4d3, purchase intent).
--
-- Why: non-owner reads move from the table to an explicit column allow-list.
-- Since 20261024023415 the allow-list view public.products_public carries the
-- buyer-facing columns and the same row predicate, and the app reads it for
-- every buyer screen (T4d2). Dropping the policy leaves two table policies:
-- products_select_owner (seller reads own rows) and products_select_admin.
-- Everyone else reads through products_public, which runs with owner rights.
--
-- Deploy order: 1) 20261024023415_products_public_view.sql (applied),
-- 2) the app release that reads the view (T4d2, on main at 014f0ac),
-- 3) this migration. Applying it before the app update would make old app
-- builds see empty lists.
--
-- Audit of caller-rights readers of public.products that would lose rows
-- (RLS policies on other tables, SECURITY INVOKER functions, security_invoker
-- views, non-definer triggers):
--   * get_profile_stats (INVOKER, granted to anon and authenticated) counts
--     SOLD listings of any seller: it would return sales_count 0 to everyone
--     except the seller. Moved to products_public below (SOLD rows are in the
--     view with the same deleted_at IS NULL predicate).
--   * fn_release_stale_reservations, fn_create_order_from_payment (INVOKER):
--     they act on RESERVED/VERIFIED rows for service role (cron, webhook);
--     non-owners already could not update products, so nothing changes.
--   * admin_product_queue_view, seller_trust_stats (security_invoker): admin
--     only, covered by products_select_admin.
--   * storage policies on bucket verification: owner or admin only.
--   * Every other function reading products is SECURITY DEFINER (bypasses RLS).
--
-- Grant review: get_profile_stats keeps its grants (PUBLIC revoked; anon,
-- authenticated and service_role execute: it is a public profile statistic).
-- It stays SECURITY INVOKER; the view runs with owner rights.

DROP POLICY IF EXISTS products_select_public ON public.products;

CREATE OR REPLACE FUNCTION public.get_profile_stats(target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_profile_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_stats(uuid) TO anon, authenticated, service_role;
