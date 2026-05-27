
DECLARE
 v_order_id UUID;
 v_seller_id UUID;
 v_status public.order_status_enum;
 v_buyer_id UUID;
 v_wallet_id UUID;
 v_wallet_pending NUMERIC;
 v_wallet_available NUMERIC;
 v_total_refund NUMERIC;
 v_item RECORD;
BEGIN
 -- 1. Bloquear shipment
 SELECT order_id, seller_id, status INTO v_order_id, v_seller_id, v_status
 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;

 IF NOT FOUND THEN
   RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
 END IF;

 IF v_status = 'cancelled' THEN
   RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT; RETURN;
 END IF;

 IF v_status NOT IN ('paid', 'preparing') THEN
   RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT; RETURN;
 END IF;

 -- 2. Autorización según rol declarado (estructura estricta: solo roles explícitos pasan)
 IF p_cancelled_by_role = 'admin' THEN
   IF NOT is_admin() THEN
     RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
   END IF;
 ELSIF p_cancelled_by_role = 'seller' THEN
   IF auth.uid() IS DISTINCT FROM v_seller_id THEN
     RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
   END IF;
 ELSIF p_cancelled_by_role = 'system' THEN
   -- cron/service_role, sin check adicional
   NULL;
 ELSE
   -- cualquier rol no reconocido (buyer, hacker, etc.) → rechazar
   RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
 END IF;

 -- 3. Obtener buyer_id para notificaciones
 SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_order_id;

 -- 4. Sumar net_payout del shipment (una sola operación)
 SELECT COALESCE(SUM(COALESCE(net_payout, 0)), 0) INTO v_total_refund
 FROM public.order_items WHERE shipment_id = p_shipment_id;

 -- 5. Revertir wallet del seller (una sola vez)
 SELECT id, pending_balance, available_balance
   INTO v_wallet_id, v_wallet_pending, v_wallet_available
 FROM public.wallets WHERE user_id = v_seller_id FOR UPDATE;

 IF v_wallet_id IS NOT NULL THEN
   UPDATE public.wallets
   SET pending_balance = GREATEST(0, pending_balance - v_total_refund),
       updated_at = now()
   WHERE id = v_wallet_id;

   INSERT INTO public.wallet_transactions
     (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
   VALUES (
     v_wallet_id, v_order_id, p_shipment_id,
     0, -v_total_refund,
     v_wallet_available,  -- available_balance intacto (el dinero estaba en escrow)
     'adjustment',
     'Cancelación (' || p_cancelled_by_role || '): ' || p_reason
   );
 END IF;

 -- 6. Liberar productos + notificar vendedor (loop liviano, sin wallet)
 FOR v_item IN
   SELECT oi.product_id, p.name as prod_name
   FROM public.order_items oi
   JOIN public.products p ON p.id = oi.product_id
   WHERE oi.shipment_id = p_shipment_id
 LOOP
   UPDATE public.products
   SET status = 'VERIFIED', reserved_at = NULL, updated_at = now()
   WHERE id = v_item.product_id;

   INSERT INTO public.notifications (user_id, type, title, message, action_path)
   VALUES (
     v_seller_id, 'warning',
     'Venta Cancelada',
     'Tu producto "' || v_item.prod_name || '" ha regresado a tu inventario por cancelación.',
     '/profile/listings'
   );
 END LOOP;

 -- 7. Marcar shipment cancelado (trigger actualiza la orden)
 UPDATE public.shipments
 SET status = 'cancelled', updated_at = now()
 WHERE id = p_shipment_id;

 INSERT INTO public.notifications (user_id, type, title, message, action_path)
 VALUES (
   v_buyer_id, 'info',
   'Pedido Cancelado',
   'Tu reembolso ha sido procesado. El dinero regresará a tu cuenta según los tiempos de tu banco.',
   '/profile/orders'
 );

 RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
 INSERT INTO public.system_logs (level, message, metadata)
 VALUES ('CRITICAL', 'Fallo en fn_cancel_shipment',
         jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
 RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
