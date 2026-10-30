
DECLARE
  v_current_status TEXT;
BEGIN
  -- 1. Validar shipment y aplicar Bloqueo Pesimista (FOR UPDATE)
  -- Esto evita condiciones de carrera si el comprador confirma manualmente al mismo milisegundo que corre el cron.
  SELECT status::TEXT INTO v_current_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE; -- ← FIX CRÍTICO: Previene la sobreescritura destructiva de estados

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 1b. Un reembolso de cancelación ya iniciado: la cancelación debe terminar, el envío no avanza.
  -- Mismo predicado que fn_begin_shipment_transfer, leído tras el bloqueo del envío.
  IF EXISTS (
    SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id AND external_started_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en tránsito (o empaque si se saltó el scan de tránsito)
  IF v_current_status NOT IN ('shipped', 'preparing') THEN
    RETURN QUERY SELECT false, format('INVALID_SHIPMENT_STATUS: %s', v_current_status); RETURN;
  END IF;

  -- 3. Marcar como entregado — SOLO inicia el reloj de 48h, NO libera fondos
  UPDATE public.shipments
  SET status = 'delivered',
      delivered_at = now(),
      updated_at = now()
  WHERE id = p_shipment_id;

  -- 4. Buyer notice, once per shipment (the carrier delivered scan writes the same key).
  PERFORM public.fn_notify_shipment_milestone(p_shipment_id, 'shipment.delivered');

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_shipment_delivered',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
