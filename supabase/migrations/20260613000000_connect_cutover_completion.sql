-- Stripe Connect cutover completion
-- Adds admin read models for Connect operations and disables legacy payout writes
-- when Connect is enabled.

CREATE OR REPLACE VIEW public.admin_seller_onboarding_view
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.username,
  pp.email,
  pp.stripe_account_id,
  pp.stripe_onboarding_status,
  (pp.stripe_onboarding_status = 'complete' AND pp.stripe_account_id IS NOT NULL) AS charges_enabled,
  p.created_at
FROM public.profiles p
JOIN public.profiles_private pp ON pp.id = p.id
WHERE p.is_verified_seller = true OR pp.stripe_account_id IS NOT NULL;

REVOKE ALL ON public.admin_seller_onboarding_view FROM PUBLIC;
REVOKE ALL ON public.admin_seller_onboarding_view FROM authenticated;
GRANT SELECT ON public.admin_seller_onboarding_view TO service_role;

CREATE OR REPLACE VIEW public.admin_connect_earnings_view
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.seller_id,
  p.username AS seller_name,
  s.stripe_payment_intent_id,
  COALESCE(ROUND((SUM(oi.price_at_purchase) + SUM(COALESCE(oi.shipping_amount, 0)) + SUM(COALESCE(oi.insurance_amount, 0))) * 100), 0)::BIGINT AS amount,
  COALESCE(ROUND(SUM(COALESCE(oi.commission_amount, oi.price_at_purchase * 0.06)) * 100), 0)::BIGINT AS application_fee_amount,
  CASE
    WHEN s.status = 'refunded' THEN 'refunded'
    WHEN s.status = 'cancelled' THEN 'failed'
    ELSE 'succeeded'
  END AS status,
  s.created_at
FROM public.shipments s
JOIN public.profiles p ON p.id = s.seller_id
LEFT JOIN public.order_items oi ON oi.shipment_id = s.id
WHERE s.stripe_payment_intent_id IS NOT NULL
GROUP BY s.id, s.seller_id, p.username, s.stripe_payment_intent_id, s.status, s.created_at;

REVOKE ALL ON public.admin_connect_earnings_view FROM PUBLIC;
REVOKE ALL ON public.admin_connect_earnings_view FROM authenticated;
GRANT SELECT ON public.admin_connect_earnings_view TO service_role;

CREATE OR REPLACE FUNCTION public.fn_request_payout(
  p_amount NUMERIC,
  p_bank_account_id UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth_user_id UUID;
    v_wallet_id UUID;
    v_current_balance NUMERIC;
    v_new_balance NUMERIC;
    v_min_amount_cents INTEGER;
    v_min_amount_pesos NUMERIC;
BEGIN
    IF EXISTS (SELECT 1 FROM public.system_settings WHERE connect_enabled = true) THEN
        RETURN QUERY SELECT false, 'CONNECT_PAYOUTS_MANAGED_BY_STRIPE'::TEXT; RETURN;
    END IF;

    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;

    SELECT min_payout_amount_cents INTO v_min_amount_cents FROM public.system_settings LIMIT 1;
    v_min_amount_pesos := v_min_amount_cents::NUMERIC / 100;

    IF p_amount < v_min_amount_pesos THEN
        RETURN QUERY SELECT false, 'AMOUNT_BELOW_MINIMUM: ' || v_min_amount_pesos::TEXT; RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.seller_bank_accounts
        WHERE id = p_bank_account_id AND user_id = v_auth_user_id AND is_verified = true
    ) THEN
        RETURN QUERY SELECT false, 'BANK_ACCOUNT_NOT_VERIFIED_OR_INVALID'::TEXT; RETURN;
    END IF;

    SELECT id, available_balance INTO v_wallet_id, v_current_balance
    FROM public.wallets
    WHERE user_id = v_auth_user_id
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        RETURN QUERY SELECT false, 'WALLET_NOT_FOUND'::TEXT; RETURN;
    END IF;

    IF v_current_balance < p_amount THEN
        RETURN QUERY SELECT false, 'INSUFFICIENT_FUNDS'::TEXT; RETURN;
    END IF;

    UPDATE public.wallets
    SET available_balance = available_balance - p_amount,
        updated_at = now()
    WHERE id = v_wallet_id
    RETURNING available_balance INTO v_new_balance;

    INSERT INTO public.payout_requests (
        user_id, wallet_id, amount, bank_account_id, status
    ) VALUES (
        v_auth_user_id, v_wallet_id, p_amount, p_bank_account_id, 'pending'
    );

    INSERT INTO public.wallet_transactions (
        wallet_id, amount, net_amount, balance_after, type, description
    ) VALUES (
        v_wallet_id, p_amount, -p_amount, v_new_balance, 'payout', 'Legacy payout request'
    );

    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (
        v_auth_user_id,
        'info',
        'Payout request received',
        'Your legacy payout request was received.',
        '/profile/wallet'
    );

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'fn_request_payout failed', jsonb_build_object('user_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;
