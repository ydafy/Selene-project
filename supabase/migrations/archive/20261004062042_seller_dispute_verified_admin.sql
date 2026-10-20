-- Seller-only verified actor boundary. Apply after N5e, before deploying resolve-dispute.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_resolve_dispute_to_seller_as_admin'
  ) THEN
    RAISE EXCEPTION 'Verified-admin RPC name already exists; inspect before retrying';
  END IF;
  -- N5e already checks audit identity, N4b authority and the N4a arbiter.
  -- Require its exact installed body and hardened service-only boundary here;
  -- this actor-only addition does not repeat the historical cutover guards.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.fn_resolve_dispute_to_seller(uuid,text)'::regprocedure
      AND p.prosecdef AND p.pronargdefaults = 0
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
      AND md5(replace(p.prosrc, E'\r\n', E'\n')) = '0617e9508ed1e6387a382df3940899b0'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'Expected hardened service-only N5e seller RPC is absent or differs';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.fn_resolve_dispute_to_seller_as_admin(
  p_dispute_id UUID,
  p_admin_note TEXT,
  p_admin_id UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    v_audit_id UUID;
BEGIN
    -- A. SECURITY: Actor supplied only by the verified-admin service boundary
    v_auth_user_id := p_admin_id;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_ACTOR';
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

    END IF;

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
    VALUES (v_auth_user_id, 'DISPUTE_RESOLVE_SELLER', p_dispute_id, jsonb_build_object('order_id', v_order_id, 'note', p_admin_note))
    RETURNING id INTO v_audit_id;

    -- One notice per distinct participant, bound to this audited verdict occurrence.
    INSERT INTO public.notifications (
        user_id, type, title, message, action_path,
        event_kind, source_event_key, event_payload
    )
    SELECT recipients.user_id, recipients.type, recipients.title,
           recipients.message, '/profile/orders/' || v_order_id::text,
           'dispute.verdict',
           'dispute.verdict:' || p_dispute_id::text || ':' || v_audit_id::text,
           jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id, 'recipient_role', recipients.recipient_role)
    FROM (VALUES
        (v_seller_id, 'seller', 'success', 'Disputa resuelta a tu favor', 'La disputa se resolvió a tu favor. Consulta el pedido para conocer el estado del pago.'),
        (v_buyer_id, 'buyer', 'warning', 'Disputa resuelta', 'La disputa se resolvió a favor del vendedor. Consulta el pedido para conocer los detalles.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'seller' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_seller', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_resolve_dispute_to_seller_as_admin(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_dispute_to_seller_as_admin(uuid,text,uuid) TO service_role;
COMMIT;
