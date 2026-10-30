-- =========================================================================
-- fn_close_account — "anonymize and close" account deletion (auth-hardening S8)
-- Migration: supabase/migrations/*_account_closure.sql
-- One transaction: lock, refuse while an obligation is pending (nothing is
-- changed), otherwise anonymize the app rows, close the auth.users row (kept,
-- because ledger foreign keys point to it) and record the closure.
-- Returns {status: 'closed' | 'already_closed' | 'blocked' | 'not_found', ...}.
-- Service role only; the Edge Function cleans Stripe and Storage afterwards.
-- Also removes the user's push tokens (expo-push-notifications T1).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_close_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status public.account_status;
  v_customer_id text;
  v_account_id text;
  v_closure public.account_closures%ROWTYPE;
  v_closed_at timestamptz := now();
  v_username text;
  v_attempt integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- A. Lock the private profile: concurrent closures of one user serialize here.
  SELECT status, stripe_customer_id, stripe_account_id
    INTO v_status, v_customer_id, v_account_id
  FROM public.profiles_private
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Idempotent retry: report the stored cleanup state and change nothing.
  SELECT * INTO v_closure FROM public.account_closures WHERE user_id = p_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_closed',
      'closed_at', v_closure.closed_at,
      'stripe_customer_id', v_closure.stripe_customer_id,
      'stripe_account_id', v_closure.stripe_account_id,
      'stripe_customer_cleanup', v_closure.stripe_customer_cleanup,
      'stripe_account_cleanup', v_closure.stripe_account_cleanup,
      'storage_cleanup', v_closure.storage_cleanup
    );
  END IF;

  -- B. Suspended and banned accounts keep their evidence and cannot self-close.
  IF v_status IN ('suspended', 'banned') THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'account_restricted');
  END IF;

  -- C. Lock the user's listings so no sale or edit slips in during the checks
  -- (ordered by id like fn_reserve_products, so a concurrent cart cannot deadlock).
  PERFORM 1 FROM public.products WHERE seller_id = p_user_id ORDER BY id FOR UPDATE;

  -- Seller side: shipments, orders and listings still moving.
  IF EXISTS (
    SELECT 1 FROM public.shipments s
    WHERE s.seller_id = p_user_id
      AND s.status NOT IN ('completed', 'cancelled', 'refunded')
  ) OR EXISTS (
    SELECT 1 FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.seller_id = p_user_id
      AND o.status NOT IN ('completed', 'cancelled', 'refunded')
  ) OR EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.seller_id = p_user_id
      AND p.status IN ('RESERVED', 'IN_DISPUTE')
      AND p.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'active_shipments');
  END IF;

  -- Buyer side: orders not finished.
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.buyer_id = p_user_id
      AND o.status NOT IN ('completed', 'cancelled', 'refunded')
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'active_orders');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.disputes d
    WHERE (d.buyer_id = p_user_id OR d.seller_id = p_user_id)
      AND d.status IN ('open', 'under_review', 'waiting_return', 'return_shipped', 'return_delivered')
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'open_disputes');
  END IF;

  -- Seller funds: a completed Connect shipment is released only when its latest
  -- payout run is paid (same rule as admin_connect_payout_release_view). Runs
  -- still pending or needing reconciliation block as well.
  IF EXISTS (
    SELECT 1 FROM public.admin_connect_payout_release_view v
    WHERE v.seller_id = p_user_id
      AND v.status = 'completed'
      AND v.stripe_payment_intent_id IS NOT NULL
      AND v.release_amount_cents > 0
      AND v.payout_run_status IS DISTINCT FROM 'paid'
  ) OR EXISTS (
    SELECT 1 FROM public.connect_payout_runs r
    WHERE r.seller_id = p_user_id
      AND r.status IN ('pending_reconciliation', 'reconciliation_needed')
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'pending_payouts');
  END IF;

  -- Refunds in flight: a started shipment cancellation whose refund is not
  -- settled (pending, failed or canceled and not resolved by an admin, or the
  -- cancellation itself unfinished) and orders still compensating a payment.
  IF EXISTS (
    SELECT 1
    FROM public.shipment_cancellation_operations c
    JOIN public.shipments s ON s.id = c.shipment_id
    JOIN public.orders o ON o.id = c.order_id
    WHERE (o.buyer_id = p_user_id OR s.seller_id = p_user_id)
      AND c.external_started_at IS NOT NULL
      AND c.refund_resolved_at IS NULL
      AND (
        c.refund_status IN ('pending', 'requires_action', 'failed', 'canceled')
        OR s.status NOT IN ('cancelled', 'refunded')
      )
  ) OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.compensation_state IS NOT NULL
      AND o.compensation_state <> 'refunded'
      AND (
        o.buyer_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.order_items oi
          WHERE oi.order_id = o.id AND oi.seller_id = p_user_id
        )
      )
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'pending_refunds');
  END IF;

  -- D. Anonymize. The public profile becomes a deleted user. The username is
  -- "deleted_" plus 12 hex characters (within the 3..20 rule); a taken
  -- candidate (another closure or a name a user chose) moves to the next one,
  -- so UNIQUE (username) never aborts the closure.
  LOOP
    v_username := 'deleted_' || substr(md5(p_user_id::text || v_attempt::text), 1, 12);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE username = v_username AND id <> p_user_id
    );
    v_attempt := v_attempt + 1;
  END LOOP;

  UPDATE public.profiles SET
    username = v_username,
    avatar_url = NULL,
    is_verified_seller = false,
    deleted_at = now(),
    updated_at = now()
  WHERE id = p_user_id;

  -- The closed account stays banned: a still-valid access token cannot publish,
  -- sell or request payouts, and no routine admin action reactivates it.
  UPDATE public.profiles_private SET
    email = NULL,
    phone_number = NULL,
    stripe_customer_id = NULL,
    stripe_account_id = NULL,
    last_sign_in_at = NULL,
    role = 'user',
    status = 'banned',
    status_reason = 'account_closed',
    status_updated_at = now(),
    status_updated_by = 'system:account_closure',
    updated_at = now()
  WHERE id = p_user_id;

  DELETE FROM public.payment_methods WHERE user_id = p_user_id;
  DELETE FROM public.favorites WHERE user_id = p_user_id;
  DELETE FROM public.blocked_users WHERE blocker_id = p_user_id OR blocked_id = p_user_id;
  DELETE FROM public.notifications WHERE user_id = p_user_id;
  DELETE FROM public.push_tokens WHERE user_id = p_user_id;

  -- A shipment keeps its origin address id, so an address a shipment points to
  -- cannot be deleted; its personal data is scrubbed in place instead.
  DELETE FROM public.addresses a
  WHERE a.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.shipments s WHERE s.origin_address_id = a.id
    );
  UPDATE public.addresses SET
    full_name = 'Deleted',
    phone = '',
    street_line1 = '',
    street_line2 = NULL,
    street_number = NULL,
    district = NULL,
    city = '',
    state = '',
    zip_code = '',
    latitude = NULL,
    longitude = NULL,
    instructions = NULL,
    label = 'deleted',
    is_default = false,
    deleted_at = COALESCE(deleted_at, now())
  WHERE user_id = p_user_id;

  -- Listings never sold are soft-deleted like fn_admin_soft_delete_product does.
  -- Listings that appear in order_items stay as ledger rows but are hidden from
  -- sale unless already SOLD.
  UPDATE public.products SET deleted_at = now(), status = 'HIDDEN',
    status_before_account_hold = NULL, updated_at = now()
  WHERE seller_id = p_user_id
    AND deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi WHERE oi.product_id = products.id
    );
  UPDATE public.products SET status = 'HIDDEN',
    status_before_account_hold = NULL, updated_at = now()
  WHERE seller_id = p_user_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD', 'HIDDEN');

  -- E. Auth side. The auth.users row stays (ledger foreign keys point to it)
  -- but loses every credential and identifier, and is banned for good. The
  -- timestamp is a finite far-future value GoTrue can parse ('infinity' is not).
  -- fn_on_auth_user_updated mirrors the NULL email into profiles_private.
  UPDATE auth.users SET
    email = NULL,
    phone = NULL,
    encrypted_password = '',
    email_confirmed_at = NULL,
    phone_confirmed_at = NULL,
    last_sign_in_at = NULL,
    raw_user_meta_data = '{}'::jsonb,
    raw_app_meta_data = jsonb_build_object('account_closed', true),
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change_token_current = '',
    email_change = '',
    phone_change = '',
    phone_change_token = '',
    reauthentication_token = '',
    banned_until = timestamptz '9999-01-01 00:00:00+00',
    updated_at = now()
  WHERE id = p_user_id;

  DELETE FROM auth.identities WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_factors WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;
  DELETE FROM auth.flow_state WHERE user_id = p_user_id;
  DELETE FROM auth.webauthn_credentials WHERE user_id = p_user_id;

  -- F. Record the closure and hand the Stripe ids to the caller for cleanup.
  INSERT INTO public.account_closures (
    user_id, closed_at, stripe_customer_id, stripe_account_id,
    stripe_customer_cleanup, stripe_account_cleanup, storage_cleanup
  ) VALUES (
    p_user_id, v_closed_at, v_customer_id, v_account_id,
    CASE WHEN v_customer_id IS NULL THEN 'not_needed' ELSE 'pending' END,
    CASE WHEN v_account_id IS NULL THEN 'not_needed' ELSE 'pending' END,
    'pending'
  );

  RETURN jsonb_build_object(
    'status', 'closed',
    'closed_at', v_closed_at,
    'stripe_customer_id', v_customer_id,
    'stripe_account_id', v_account_id,
    'stripe_customer_cleanup', CASE WHEN v_customer_id IS NULL THEN 'not_needed' ELSE 'pending' END,
    'stripe_account_cleanup', CASE WHEN v_account_id IS NULL THEN 'not_needed' ELSE 'pending' END,
    'storage_cleanup', 'pending'
  );
END;
$$;

COMMENT ON FUNCTION public.fn_close_account(uuid) IS
  'Service-only (SECURITY DEFINER): anonymizes and closes an account in one transaction, or returns a blocked reason with no change. Idempotent: a second call returns already_closed.';

REVOKE EXECUTE ON FUNCTION public.fn_close_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_close_account(uuid) TO service_role;
