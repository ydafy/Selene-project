-- ============================================================================
-- A Connect shipment is marked refunded only after its Stripe refund.
--
-- resolve-dispute-refund creates the Stripe refund (reverse_transfer) and then
-- records it. Two older paths could mark a Connect shipment refunded without
-- any Stripe refund:
--   * fn_seller_confirm_return_shipment resolved the dispute for the buyer and
--     called fn_complete_shipment_refund. Its header said only admins should
--     use it, yet it accepted the shipment's seller and was executable by
--     authenticated. No client calls it; it is dropped.
--   * fn_complete_shipment_refund only set status = 'refunded' for Connect
--     shipments. It now refuses them with CONNECT_REFUND_REQUIRES_STRIPE before
--     any write. The legacy (non-Connect) path is unchanged; the dispute crons
--     already call it only for legacy shipments.
--
-- Signature, SECURITY DEFINER, search_path and owner are those deployed.
--
-- Grant review: fn_complete_shipment_refund is not meant for API roles; it
-- restates REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE
-- TO service_role.
--
-- Canonical copy: supabase/queries/shipments/fn_complete_shipment_refund.sql.
-- Apply this OR that, not both; the DROP is only here.
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.fn_seller_confirm_return_shipment(uuid);

CREATE OR REPLACE FUNCTION public.fn_complete_shipment_refund(p_shipment_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_buyer_id UUID;
  v_shipment_status TEXT;
  v_stripe_payment_intent_id TEXT;
  v_dispute_id UUID;
BEGIN
  -- 1. Validar shipment y obtener datos (Usa public.shipments y public.orders)
  SELECT s.order_id, s.seller_id, s.status::TEXT, s.stripe_payment_intent_id, o.buyer_id
  INTO v_order_id, v_seller_id, v_shipment_status, v_stripe_payment_intent_id, v_buyer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- Connect shipments are refunded in Stripe by resolve-dispute-refund, which
  -- records the refund itself. Marking one refunded here would claim a refund
  -- that never happened, so refuse before any write.
  IF v_stripe_payment_intent_id IS NOT NULL THEN
    RETURN QUERY SELECT false, 'CONNECT_REFUND_REQUIRES_STRIPE'::TEXT; RETURN;
  END IF;

  -- 1b. No reembolsar shipments ya refunded o completed (fondos ya liberados)
  IF v_shipment_status IN ('refunded', 'completed', 'cancelled', 'pending') THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_REFUNDABLE'::TEXT; RETURN;
  END IF;

  -- 2. Obtener dispute asociado
  SELECT id INTO v_dispute_id FROM public.disputes
  WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  LIMIT 1;

  -- 3. Liberar productos de este shipment
  UPDATE public.products SET status = 'IN_REVIEW', updated_at = now()
  WHERE id IN (SELECT product_id FROM public.order_items WHERE shipment_id = p_shipment_id);

  -- 4. Marcar shipment como refunded (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_shipment_id;

  -- 5. Resolver la disputa si existe
  IF v_dispute_id IS NOT NULL THEN
    UPDATE public.disputes
    SET status = 'resolved', resolution_type = 'buyer', updated_at = now()
    WHERE id = v_dispute_id;
  END IF;

  -- 6. Notificaciones
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES
    (v_buyer_id, 'success', 'Reembolso Finalizado', 'Tu dinero ha sido devuelto.', '/profile/orders/' || v_order_id),
    (v_seller_id, 'warning', 'Producto Reembolsado', 'El producto está en revisión técnica.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_complete_shipment_refund',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_complete_shipment_refund(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_complete_shipment_refund(uuid) TO service_role;

COMMIT;
