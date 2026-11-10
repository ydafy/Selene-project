CREATE OR REPLACE FUNCTION public.fn_notify_dispute_opened()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_buyer_id uuid;
  v_seller_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.status IS DISTINCT FROM 'open'
     OR NEW.shipment_id IS NULL THEN
    RAISE EXCEPTION 'Invalid dispute opened notification authority or state';
  END IF;

  SELECT o.buyer_id, s.seller_id INTO v_buyer_id, v_seller_id
  FROM public.orders o
  JOIN public.shipments s ON s.order_id = o.id
  WHERE o.id = NEW.order_id AND s.id = NEW.shipment_id;

  IF NOT FOUND OR v_buyer_id IS NULL OR v_seller_id IS NULL
     OR NEW.buyer_id IS DISTINCT FROM v_buyer_id
     OR NEW.seller_id IS DISTINCT FROM v_seller_id THEN
    RAISE EXCEPTION 'Dispute order, shipment, buyer or seller relationship invalid';
  END IF;

  IF v_seller_id IS DISTINCT FROM v_buyer_id THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, action_path,
      event_kind, source_event_key, event_payload
    ) VALUES (
      v_seller_id, 'warning', 'Disputa abierta',
      'Se abrió una disputa sobre una de tus ventas. Consulta los detalles del caso.',
      '/profile/orders/' || NEW.order_id::text
        || COALESCE('?shipment_id=' || NEW.shipment_id::text, ''),
      'dispute.opened', 'dispute.opened:' || NEW.id::text,
      jsonb_build_object('dispute_id', NEW.id, 'order_id', NEW.order_id, 'recipient_role', 'seller')
    ) ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_notify_dispute_opened"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_notify_dispute_opened"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_notify_dispute_opened"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_notify_dispute_opened"() FROM PUBLIC, "anon", "authenticated";
