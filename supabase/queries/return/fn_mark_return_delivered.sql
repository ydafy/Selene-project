
DECLARE
  v_status      TEXT;
  v_buyer_id    UUID;
  v_seller_id   UUID;
  v_order_id    UUID;
BEGIN
  -- 1. Validar dispute y aplicar Bloqueo Pesimista (FOR UPDATE) para evitar race conditions
  -- Esto evita que el cron sobreescriba un estado 'resolved' manual si el vendedor confirma al mismo milisegundo.
  SELECT d.status::TEXT, d.buyer_id, d.seller_id, d.order_id
  INTO v_status, v_buyer_id, v_seller_id, v_order_id
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

  -- 3. Marcar como entregado (Inicia el reloj de 48 horas de gracia para unboxing del vendedor)
  UPDATE public.disputes
  SET status = 'return_delivered',
      return_delivered_at = now(),
      updated_at = now()
  WHERE id = p_dispute_id;

  -- 4. Notificaciones cruzadas sincronizadas
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES
    -- FIX UX: Corregido a "48 horas" para alinear con el timeout real de la Fase 10 y evitar reclamos
    (v_seller_id, 'warning', 'Retorno Entregado', 'Has recibido el producto devuelto. Tienes 48 horas para revisarlo y reportar anomalías.', '/profile/orders/' || v_order_id),
    (v_buyer_id, 'info', 'Paquete devuelto', 'El vendedor ha recibido el producto. Tu reembolso se procesará en breve.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_return_delivered',
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
