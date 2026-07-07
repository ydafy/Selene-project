CREATE OR REPLACE FUNCTION public.fn_request_payout(p_amount NUMERIC, p_bank_account_id UUID)

DECLARE
    v_auth_user_id UUID;
    v_wallet_id UUID;
    v_current_balance NUMERIC;
    v_new_balance NUMERIC;
    v_min_amount_cents INTEGER;
    v_min_amount_pesos NUMERIC;
BEGIN
    -- Connect cutover guard: manual payout requests are disabled once Connect is enabled.
    -- Legacy tables remain read-only historical audit records after wallet drain.
    IF EXISTS (SELECT 1 FROM public.system_settings WHERE connect_enabled = true) THEN
        RETURN QUERY SELECT false, 'CONNECT_PAYOUTS_MANAGED_BY_STRIPE'::TEXT; RETURN;
    END IF;

    -- A. SEGURIDAD: Obtener ID del usuario desde el JWT
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;

    -- B. VALIDACIÓN: Monto Mínimo (SSOT)
    SELECT min_payout_amount_cents INTO v_min_amount_cents FROM public.system_settings LIMIT 1;
    v_min_amount_pesos := v_min_amount_cents::NUMERIC / 100;

    IF p_amount < v_min_amount_pesos THEN
        RETURN QUERY SELECT false, 'AMOUNT_BELOW_MINIMUM: ' || v_min_amount_pesos::TEXT; RETURN;
    END IF;

    -- C. VALIDACIÓN: Cuenta Bancaria
    IF NOT EXISTS (
        SELECT 1 FROM public.seller_bank_accounts
        WHERE id = p_bank_account_id AND user_id = v_auth_user_id AND is_verified = true
    ) THEN
        RETURN QUERY SELECT false, 'BANK_ACCOUNT_NOT_VERIFIED_OR_INVALID'::TEXT; RETURN;
    END IF;

    -- D. BLOQUEO: Wallet del usuario
    SELECT id, available_balance INTO v_wallet_id, v_current_balance
    FROM public.wallets
    WHERE user_id = v_auth_user_id
    FOR UPDATE; -- BLOQUEO CRÍTICO: Nadie más toca esta billetera hasta terminar

    IF v_wallet_id IS NULL THEN
        RETURN QUERY SELECT false, 'WALLET_NOT_FOUND'::TEXT; RETURN;
    END IF;

    -- E. INTEGRIDAD: Fondos suficientes
    IF v_current_balance < p_amount THEN
        RETURN QUERY SELECT false, 'INSUFFICIENT_FUNDS'::TEXT; RETURN;
    END IF;

    -- F. EJECUCIÓN: Restar saldo y actualizar

    UPDATE public.wallets
    SET available_balance = available_balance - p_amount,
        updated_at = now()
    WHERE id = v_wallet_id
    RETURNING available_balance INTO v_new_balance;

    -- G. PERSISTENCIA: Solicitud para el Admin (CSV)
    INSERT INTO public.payout_requests (
        user_id, wallet_id, amount, bank_account_id, status
    ) VALUES (
        v_auth_user_id, v_wallet_id, p_amount, p_bank_account_id, 'pending'
    );

    -- H. LEDGER: Registro inmutable
    INSERT INTO public.wallet_transactions (
        wallet_id, amount, net_amount, balance_after, type, description
    ) VALUES (
        v_wallet_id, p_amount, -p_amount, v_new_balance, 'payout', 'Retiro solicitado a cuenta CLABE'
    );

    -- I. NOTIFICACIÓN: Feedback al usuario
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (
        v_auth_user_id,
        'info',
        'Retiro en Proceso',
        'Tu solicitud de retiro por $' || p_amount::TEXT || ' ha sido recibida. El depósito se reflejará en los días de pago programados.',
        '/profile/wallet'
    );

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    -- Loguear error crítico antes de abortar
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_request_payout', jsonb_build_object('user_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
