-- =========================================================================
-- Registro de pago de guía de retorno (llamado por stripe-webhooks)
-- Único caller: Edge Function stripe-webhooks con service_role.
-- NO es un payout al vendedor — es un registro informativo en el ledger
-- de que Stripe cobró la guía al comprador/vendedor.
-- =========================================================================

DECLARE
    v_seller_id UUID;
    v_wallet_id UUID;
    v_order_id UUID;
    v_shipment_id UUID;
BEGIN
    -- 1. Validar disputa con bloqueo pesimista
    SELECT seller_id, order_id, shipment_id
      INTO v_seller_id, v_order_id, v_shipment_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'DISPUTE_NOT_FOUND: %', p_dispute_id USING ERRCODE = 'P0002';
    END IF;

    -- 2. Obtener wallet del vendedor
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_seller_id;

    -- 3. Registro informativo en ledger (no altera balance disponible)
    INSERT INTO public.wallet_transactions (
        wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description
    ) SELECT
        v_wallet_id, v_order_id, v_shipment_id, p_amount, 0, available_balance, 'adjustment',
        'Pago externo (Stripe) de guía de retorno'
    FROM public.wallets WHERE id = v_wallet_id;

    -- 4. Actualizar disputa: pago procesado + transición a return_shipped
    UPDATE public.disputes
    SET return_payout_id = p_stripe_id,
        return_payout_status = 'paid',
        status = 'return_shipped',
        updated_at = now()
    WHERE id = p_dispute_id;
END;