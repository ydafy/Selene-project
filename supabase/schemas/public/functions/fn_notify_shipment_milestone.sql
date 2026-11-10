CREATE OR REPLACE FUNCTION public.fn_notify_shipment_milestone (
  p_shipment_id uuid,
  p_event_kind  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_order_id uuid;
  v_buyer_id uuid;
BEGIN
  IF p_event_kind IS NULL OR p_event_kind NOT IN ('shipment.in_transit', 'shipment.delivered') THEN
    RAISE EXCEPTION 'INVALID_SHIPMENT_MILESTONE';
  END IF;

  SELECT s.order_id, o.buyer_id INTO v_order_id, v_buyer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_shipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;

  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    type, title, message, action_path
  ) VALUES (
    v_buyer_id,
    p_event_kind,
    p_event_kind || ':' || p_shipment_id::text,
    jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                       'recipient_role', 'buyer'),
    CASE WHEN p_event_kind = 'shipment.in_transit' THEN 'info' ELSE 'success' END,
    CASE WHEN p_event_kind = 'shipment.in_transit' THEN 'Tu envío va en camino'
         ELSE 'Tu envío fue entregado' END,
    CASE WHEN p_event_kind = 'shipment.in_transit'
         THEN 'La paquetería ya lleva un envío de tu pedido. Puedes seguirlo desde tu pedido.'
         ELSE 'Revisa tus productos. Tienes 48 horas desde la entrega para reportar un problema.' END,
    '/profile/orders/' || v_order_id::text
      || COALESCE('?shipment_id=' || p_shipment_id::text, '')
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_notify_shipment_milestone"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_notify_shipment_milestone"(uuid, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_notify_shipment_milestone"(uuid, text) FROM PUBLIC, "service_role", "anon", "authenticated";
