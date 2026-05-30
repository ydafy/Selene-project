-- =========================================================================
-- Confirmación de retorno por parte del vendedor (admin override ONLY)
-- El flujo principal es: return_delivered trigger → fn_complete_shipment_refund.
-- Esta función es SOLO para que el admin fuerce la confirmación cuando hay
-- contention (e.g., el trigger automático falló, evidence insuficiente, etc.)
-- El vendedor NO debe llamar esto; el trigger automático lo maneja.
-- =========================================================================

DECLARE
  v_seller_id UUID;
  v_order_id UUID;
  v_dispute_id UUID;
  v_dispute_status public.dispute_status;
BEGIN
  -- 1. Validar shipment
  SELECT s.seller_id, s.order_id INTO v_seller_id, v_order_id
  FROM public.shipments s WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Obtener dispute activo de este shipment
  SELECT id, status INTO v_dispute_id, v_dispute_status
  FROM public.disputes
  WHERE shipment_id = p_shipment_id AND seller_id = v_seller_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_dispute_id IS NULL THEN
    RETURN QUERY SELECT false, 'NO_ACTIVE_DISPUTE'::TEXT; RETURN;
  END IF;

  -- 3. Autorización: seller del shipment o admin con override
  IF v_seller_id IS DISTINCT FROM auth.uid() AND NOT is_admin() THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 4. Validar status de la disputa
  IF v_dispute_status NOT IN ('return_delivered', 'waiting_return') THEN
    RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
  END IF;

  -- 5. Actualizar disputa
  UPDATE public.disputes
  SET status = 'resolved',
      resolution_type = 'buyer',
      return_delivered_at = COALESCE(return_delivered_at, now()),
      admin_notes = COALESCE(admin_notes, '') || CASE WHEN is_admin() THEN E'\n[SYSTEM]: Administrador forzó confirmación de retorno.' ELSE E'\n[SYSTEM]: Vendedor confirmó recepción manual.' END,
      updated_at = now()
  WHERE id = v_dispute_id;

  -- 6. Auditoría (solo admins, seller no contamina la bitácora administrativa)
  IF is_admin() THEN
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (auth.uid(), 'ADMIN_FORCED_RETURN_CONFIRMATION', v_dispute_id, jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id));
  END IF;

  -- 7. Gatillar refund del shipment
  RETURN QUERY SELECT * FROM public.fn_complete_shipment_refund(p_shipment_id);

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_seller_confirm_return_shipment',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
