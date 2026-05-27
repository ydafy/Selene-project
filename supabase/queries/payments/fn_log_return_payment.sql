
DECLARE
    v_seller_id UUID;
    v_wallet_id UUID;
    v_order_id UUID;
BEGIN
    SELECT seller_id, order_id INTO v_seller_id, v_order_id
    FROM public.disputes WHERE id = p_dispute_id;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_seller_id;

    -- REGISTRO INFORMATIVO (No resta del balance)
    INSERT INTO public.wallet_transactions (
        wallet_id, order_id, amount, net_amount, balance_after, type, description
    ) SELECT
        v_wallet_id, v_order_id, p_amount, 0, available_balance, 'adjustment', 'Pago externo (Stripe) de guía de retorno'
    FROM public.wallets WHERE id = v_wallet_id;

    UPDATE public.disputes
    SET return_payout_id = p_stripe_id,
        return_payout_status = 'paid',
        updated_at = now()
    WHERE id = p_dispute_id;
END;
