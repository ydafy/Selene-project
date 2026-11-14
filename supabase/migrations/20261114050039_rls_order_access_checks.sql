SET local check_function_bodies = off;

DROP POLICY "order_items_select_v4" ON "public"."order_items";

DROP POLICY "orders_select_v4" ON "public"."orders";

DROP POLICY "shipment tracking events are visible to participants and admins" ON "public"."shipment_tracking_events";

CREATE OR REPLACE FUNCTION internal.fn_check_order_access (
  p_order_id uuid,
  p_user_id  uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
    RETURN EXISTS (
        -- Regla 1: El usuario es el comprador de la orden
        SELECT 1 FROM public.orders WHERE id = p_order_id AND buyer_id = p_user_id
        UNION ALL
        -- Regla 2: El usuario es vendedor de algún artículo en la orden
        SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND seller_id = p_user_id
    );
END; $function$;

CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$

DECLARE
    v_role TEXT;
    v_status public.account_status;
BEGIN
    SELECT role, status
    INTO v_role, v_status
    FROM public.profiles_private
    WHERE id = auth.uid();

    -- Suspended or banned admins lose admin authority
    RETURN COALESCE(v_role = 'admin' AND COALESCE(v_status, 'active') = 'active', false);
END;
$function$;

CREATE POLICY "order_items_select_v4" ON "public"."order_items"
  FOR SELECT
  TO PUBLIC
  USING (((seller_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.buyer_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "orders_select_v4" ON "public"."orders"
  FOR SELECT
  TO PUBLIC
  USING ((( SELECT public.is_admin() AS is_admin) OR internal.fn_check_order_access(id, ( SELECT auth.uid() AS uid))));

CREATE POLICY "shipment tracking events are visible to participants and admins" ON "public"."shipment_tracking_events"
  FOR SELECT
  TO "authenticated"
  USING (((EXISTS ( SELECT 1
   FROM (public.shipments s
     JOIN public.orders o ON ((o.id = s.order_id)))
  WHERE ((s.id = shipment_tracking_events.shipment_id) AND ((o.buyer_id = ( SELECT auth.uid() AS uid)) OR (s.seller_id = ( SELECT auth.uid() AS uid)))))) OR
    ( SELECT public.is_admin() AS is_admin)));
