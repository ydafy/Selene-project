
DECLARE
  v_seller_id   UUID;
  v_status      TEXT;
  v_shipment_id UUID;
BEGIN
  -- 1. Validar dispute existe
  SELECT d.seller_id, d.status::TEXT, d.shipment_id
  INTO v_seller_id, v_status, v_shipment_id
  FROM public.disputes d WHERE d.id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Validar caller es el seller legítimo de la disputa
  IF v_seller_id IS DISTINCT FROM p_caller_id THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 3. Validar dispute en estado correcto (Esperando guía de retorno)
  IF v_status IS DISTINCT FROM 'waiting_return' THEN
    RETURN QUERY SELECT false,
      format('INVALID_DISPUTE_STATUS: %s', v_status)::TEXT;
    RETURN;
  END IF;

  -- 4. Auditoría (idempotente — siempre loguea de forma informativa)
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Return label initiated by seller',
    jsonb_build_object(
      'dispute_id', p_dispute_id,
      'shipment_id', v_shipment_id,
      'seller_id', v_seller_id
    ));

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  -- Diagnóstico de errores del proyecto.
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_seller_initiate_return_label',
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
