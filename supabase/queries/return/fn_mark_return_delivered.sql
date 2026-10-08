
DECLARE
  v_status      TEXT;
  v_buyer_id    UUID;
  v_seller_id   UUID;
  v_order_id    UUID;
  v_shipment_id UUID;
  v_return_delivered_at timestamptz;
BEGIN
  -- 1. Validar dispute y aplicar Bloqueo Pesimista (FOR UPDATE) para evitar race conditions
  -- Esto evita que el cron sobreescriba un estado 'resolved' manual si el vendedor confirma al mismo milisegundo.
  SELECT d.status::TEXT, d.buyer_id, d.seller_id, d.order_id, d.shipment_id
  INTO v_status, v_buyer_id, v_seller_id, v_order_id, v_shipment_id
  FROM public.disputes d
  WHERE d.id = p_dispute_id
  FOR UPDATE; -- ← FIX CRÍTICO: Previene doble reembolso fraudulento por sobreescritura de estado

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en flujo de retorno activo (en camino o esperando envío)
  IF v_status NOT IN ('waiting_return', 'return_shipped') THEN
    RETURN QUERY SELECT false, format('INVALID_DISPUTE_STATUS: %s', v_status); RETURN;
  END IF;

  -- Verify the stored participants before publishing a trusted seller-scoped event.
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shipments s ON s.order_id = o.id
    WHERE o.id = v_order_id AND s.id = v_shipment_id
      AND o.buyer_id = v_buyer_id AND s.seller_id = v_seller_id
  ) THEN
    RAISE EXCEPTION 'Invalid return delivery relationship';
  END IF;

  -- 3. Marcar como entregado (Inicia el reloj de 48 horas de gracia para unboxing del vendedor)
  UPDATE public.disputes
  SET status = 'return_delivered',
      return_delivered_at = clock_timestamp(),
      updated_at = now()
  WHERE id = p_dispute_id
  RETURNING return_delivered_at INTO v_return_delivered_at;

  IF v_return_delivered_at IS NULL OR v_order_id IS NULL
     OR v_buyer_id IS NULL OR v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Invalid return delivery identity or recipients';
  END IF;

  INSERT INTO public.notifications (
    user_id, type, title, message, action_path,
    event_kind, source_event_key, event_payload
  )
  SELECT recipients.user_id, recipients.notice_type, recipients.title,
    recipients.message, '/profile/orders/' || v_order_id::text,
    'return.delivered',
    'return.delivered:' || p_dispute_id::text || ':' || extract(epoch FROM v_return_delivered_at)::text,
    jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id,
                       'recipient_role', recipients.recipient_role)
  FROM (VALUES
    (v_seller_id, 'seller', 'warning', 'Retorno entregado',
     'El retorno fue entregado. Revisa el producto y reporta cualquier anomalía dentro de 48 horas.'),
    (v_buyer_id, 'buyer', 'info', 'Retorno entregado',
     'Se registró la entrega del retorno. Consulta el estado de tu caso.')
  ) AS recipients(user_id, recipient_role, notice_type, title, message)
  WHERE true AND (recipients.recipient_role = 'seller' OR v_buyer_id IS DISTINCT FROM v_seller_id)
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_return_delivered',
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
