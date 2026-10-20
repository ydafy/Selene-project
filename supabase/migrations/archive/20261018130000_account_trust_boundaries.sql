-- Account trust boundaries: suspended/banned sellers cannot insert or edit listings,
-- clients can only insert fresh PENDING_VERIFICATION listings and never write the
-- account-hold column, clients can only update user-editable profile columns, new-sale
-- reservations skip products of restricted sellers and reject banned buyers, and the
-- legacy payout request rejects restricted accounts.
-- Forward-only. Depends on 20261018120000_account_status_lifecycle.sql
-- (products.status_before_account_hold) being applied first.
-- CREATE OR REPLACE keeps the deployed RPC signatures and ACLs; no overload is added.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.products'::regclass
      AND attname = 'status_before_account_hold'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'EXPECTED_ACCOUNT_HOLD_COLUMN_MISSING';
  END IF;
  IF to_regprocedure('public.fn_reserve_products(uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_DEPLOYED_RESERVE_RPC_MISSING';
  END IF;
  IF to_regprocedure('public.fn_request_payout(numeric,uuid)') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_DEPLOYED_PAYOUT_RPC_MISSING';
  END IF;
END;
$$;

-- Caller-only check: no parameter, so it cannot probe another account's status.
CREATE OR REPLACE FUNCTION public.fn_current_account_is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
SELECT NOT EXISTS (
    SELECT 1
    FROM public.profiles_private
    WHERE id = (SELECT auth.uid())
    AND status IN ('suspended', 'banned')
);
$$;

REVOKE EXECUTE ON FUNCTION public.fn_current_account_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_current_account_is_active() TO authenticated, service_role;

-- D1: direct inserts can only create a fresh listing awaiting verification.
DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = seller_id
    AND status = 'PENDING_VERIFICATION'::public.product_status_enum
    AND verified_at IS NULL
    AND deleted_at IS NULL
    AND reserved_at IS NULL
    AND locked_by IS NULL
    AND status_before_account_hold IS NULL
    AND (SELECT public.fn_current_account_is_active())
  );

-- D2: restricted sellers cannot edit listings; owners can never set the hold column,
-- which would otherwise choose the status restored when a suspension is lifted.
DROP POLICY IF EXISTS products_update_owner ON public.products;
CREATE POLICY products_update_owner ON public.products
  FOR UPDATE TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    AND deleted_at IS NULL
    AND status = ANY (ARRAY['PENDING_VERIFICATION', 'VERIFIED', 'HIDDEN', 'REJECTED']::public.product_status_enum[])
    AND (SELECT public.fn_current_account_is_active())
  )
  WITH CHECK (
    seller_id = (SELECT auth.uid())
    AND status = ANY (ARRAY['PENDING_VERIFICATION', 'HIDDEN', 'IN_REVIEW']::public.product_status_enum[])
    AND status_before_account_hold IS NULL
    AND (SELECT public.fn_current_account_is_active())
  );

-- D4: trust signals (verified seller, ratings, sales) are server-maintained.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (username, avatar_url, updated_at) ON public.profiles TO authenticated;

-- D5: new sales skip restricted sellers; banned buyers cannot start a purchase.
CREATE OR REPLACE FUNCTION public.fn_reserve_products(
  p_buyer_id UUID,
  p_product_ids UUID[]
)
RETURNS TABLE(total_price NUMERIC, success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
  v_sum NUMERIC;
  v_reserved_ids UUID[];
BEGIN
  -- 0. DEFENSA: Carrito nulo o vacío (retorno inmediato en 0ms)
  IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, false, 'EMPTY_CART'::TEXT;
    RETURN;
  END IF;

  -- Banned buyers cannot purchase; suspended buyers keep their own purchases
  IF EXISTS (
    SELECT 1 FROM public.profiles_private pp
    WHERE pp.id = p_buyer_id AND pp.status = 'banned'
  ) THEN
    RETURN QUERY SELECT 0::NUMERIC, false, 'ACCOUNT_RESTRICTED'::TEXT;
    RETURN;
  END IF;

  -- 1. LIMPIEZA IDEMPOTENTE: Recuperar reservas vencidas (> 10 min) de este carrito
  UPDATE public.products
  SET status = 'VERIFIED',
      updated_at = now(),
      reserved_at = NULL
  WHERE id = ANY(p_product_ids)
    AND status = 'RESERVED'
    AND reserved_at < now() - interval '10 minutes';

  -- 2. SEGURO ANTI-DEADLOCK: Bloqueo determinístico en orden alfabético de UUID
  PERFORM 1
  FROM public.products
  WHERE id = ANY(p_product_ids)
  ORDER BY id
  FOR UPDATE;

  -- 3. RESERVA ATÓMICA: Solo productos VERIFIED que no sean del comprador
  --    ni de vendedores suspendidos o baneados
  WITH reserved AS (
    UPDATE public.products
    SET status = 'RESERVED',
        updated_at = now(),
        reserved_at = now()
    WHERE id = ANY(p_product_ids)
      AND status = 'VERIFIED'
      AND seller_id <> p_buyer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles_private pp
        WHERE pp.id = products.seller_id
          AND pp.status IN ('suspended', 'banned')
      )
    RETURNING id, price
  )
  SELECT array_agg(id), COUNT(*), COALESCE(SUM(price), 0)
    INTO v_reserved_ids, v_count, v_sum
  FROM reserved;

  -- 4. ALL-OR-NOTHING: Si no se reservó el 100% del carrito, revertir lo parcial
  IF v_count = cardinality(p_product_ids) THEN
    RETURN QUERY SELECT v_sum, true, NULL::TEXT;
  ELSE
    IF v_count > 0 THEN
      UPDATE public.products
      SET status = 'VERIFIED',
          updated_at = now(),
          reserved_at = NULL
      WHERE id = ANY(v_reserved_ids)
        AND status = 'RESERVED';
    END IF;
    RETURN QUERY SELECT 0::NUMERIC, false, 'SOME_PRODUCTS_UNAVAILABLE'::TEXT;
  END IF;
END;
$$;

-- D6: legacy payout requests reject suspended or banned accounts.
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

    IF EXISTS (
        SELECT 1 FROM public.profiles_private
        WHERE id = v_auth_user_id AND status IN ('suspended', 'banned')
    ) THEN
        RETURN QUERY SELECT false, 'ACCOUNT_RESTRICTED'::TEXT; RETURN;
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
        v_wallet_id, p_amount, -p_amount, v_new_balance, 'payout', 'Retiro solicitado a cuenta CLABE'
    );

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
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_request_payout', jsonb_build_object('user_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY['fn_current_account_is_active', 'fn_reserve_products', 'fn_request_payout'])
    GROUP BY p.proname
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'UNEXPECTED_TRUST_BOUNDARY_RPC_OVERLOADS';
  END IF;
END;
$$;

COMMIT;
