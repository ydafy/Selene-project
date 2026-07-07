
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_seller_id UUID;
    v_buyer_id UUID;
    v_shipment_id UUID;
    v_status public.dispute_status;
    v_total_payout NUMERIC;
    v_new_balance NUMERIC;
    v_wallet_id UUID;
BEGIN
    -- A. SEGURIDAD: Obtener ID desde JWT y validar sesión
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. VALIDACIÓN DE ROL: Solo Admins
    IF NOT EXISTS (SELECT 1 FROM public.profiles_private WHERE id = v_auth_user_id AND role = 'admin') THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED_ADMIN_ONLY'::TEXT; RETURN;
    END IF;

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila
    SELECT order_id, seller_id, buyer_id, status, shipment_id
    INTO v_order_id, v_seller_id, v_buyer_id, v_status, v_shipment_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    -- Permitimos resolver a favor del vendedor si está en investigación o si ya recibió el retorno (pero impugnó)
    IF v_status NOT IN ('open', 'under_review', 'return_delivered', 'waiting_return') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

   -- D. LÓGICA FINANCIERA: Liberar el dinero al vendedor de forma aislada
    -- Connect guard: if the shipment was paid via Stripe Connect, skip wallet
    -- operations. We do NOT update shipments here to avoid triggering the
    -- Database Webhook twice. Section F.1 will handle the single atomic update.
    IF v_shipment_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.shipments
      WHERE id = v_shipment_id AND stripe_payment_intent_id IS NOT NULL
    ) THEN
      -- Skip wallet operations entirely. Let Section F.1 handle the
      -- single, atomic completed update.
      NULL;

      RAISE NOTICE 'Connect dispute resolved: shipment % skips wallet operations', v_shipment_id;
    ELSE
      -- Legacy path: wallet pending→available
      -- FIX Double Payout: si hay shipment_id, sumamos solo los items de ESE shipment
      IF v_shipment_id IS NOT NULL THEN
          SELECT COALESCE(SUM(net_payout), 0) INTO v_total_payout
          FROM public.order_items
          WHERE shipment_id = v_shipment_id;
      ELSE
          -- Fallback pre-migration (históricos sin shipment_id)
          SELECT COALESCE(SUM(net_payout), 0) INTO v_total_payout
          FROM public.order_items
          WHERE order_id = v_order_id AND seller_id = v_seller_id;
      END IF;

      -- Mover dinero de Pending a Available con precisión absoluta
      UPDATE public.wallets
      SET pending_balance = GREATEST(0, pending_balance - v_total_payout),
          available_balance = available_balance + v_total_payout,
          updated_at = now()
      WHERE user_id = v_seller_id
      RETURNING id, available_balance INTO v_wallet_id, v_new_balance;

      -- E. LEDGER: Registro inmutable del movimiento
      INSERT INTO public.wallet_transactions (
          wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description
      ) VALUES (
          v_wallet_id, v_order_id, v_shipment_id, v_total_payout, v_total_payout, v_new_balance,
          'release', 'Resolución de disputa a favor del vendedor'
      );

    END IF

    -- F. ACTUALIZAR ESTADOS: Cerrar caso
    UPDATE public.disputes
    SET status = 'resolved',
        resolution_type = 'seller',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- F.1 Actualizar a nivel shipment (post-migration) u order (pre-migration)
    IF v_shipment_id IS NOT NULL THEN
        UPDATE public.shipments SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_shipment_id;
    ELSE
        UPDATE public.orders SET status = 'completed', updated_at = now() WHERE id = v_order_id;
    END IF;

    -- G. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_RESOLVE_SELLER', p_dispute_id, jsonb_build_object('order_id', v_order_id, 'note', p_admin_note));

    -- H. NOTIFICACIONES: Avisar a ambas partes
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES
        (v_seller_id, 'success', 'Disputa Ganada', 'El administrador resolvió a tu favor tras revisar la evidencia. Fondos liberados.', '/profile/orders/' || v_order_id),
        (v_buyer_id, 'error', 'Disputa Cerrada', 'La revisión de la orden ha concluido a favor del vendedor. El caso ha sido cerrado.', '/profile/orders/' || v_order_id);

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_seller', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
