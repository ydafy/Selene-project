SET local check_function_bodies = off;

-- Hand edit: pg-delta recreated the type with its columns, default, views, policies, index and trigger; RENAME VALUE keeps every stored row and OID-bound dependency, so only function bodies and the cron command that store labels as text are replaced.
ALTER TYPE public.product_status RENAME VALUE 'PENDING_VERIFICATION' TO 'pending_verification';
ALTER TYPE public.product_status RENAME VALUE 'IN_REVIEW' TO 'in_review';
ALTER TYPE public.product_status RENAME VALUE 'VERIFIED' TO 'verified';
ALTER TYPE public.product_status RENAME VALUE 'SOLD' TO 'sold';
ALTER TYPE public.product_status RENAME VALUE 'REJECTED' TO 'rejected';
ALTER TYPE public.product_status RENAME VALUE 'HIDDEN' TO 'hidden';
ALTER TYPE public.product_status RENAME VALUE 'RESERVED' TO 'reserved';
ALTER TYPE public.product_status RENAME VALUE 'IN_DISPUTE' TO 'in_dispute';

CREATE OR REPLACE FUNCTION public.fn_admin_restore_product (
  p_product_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_auth_user_id UUID;
  v_previous_status public.product_status;
BEGIN
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  -- Read previous_status from the last soft-delete audit log
  SELECT (details->>'previous_status')::public.product_status
  INTO v_previous_status
  FROM public.admin_audit_logs
  WHERE target_id = p_product_id::text
    AND action_type = 'PRODUCT_SOFT_DELETE'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Fallback to pending_verification if no admin log found (seller self-deleted).
  -- Never auto-approve to verified — force re-moderation.
  IF v_previous_status IS NULL THEN
    v_previous_status := 'pending_verification'::public.product_status;
  END IF;

  UPDATE public.products
  SET status = v_previous_status,
      deleted_at = NULL,
      updated_at = now()
  WHERE id = p_product_id
    AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    'PRODUCT_RESTORE',
    p_product_id::text,
    jsonb_build_object('restored_status', v_previous_status::text)
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_soft_delete_product (
  p_product_id uuid,
  p_reason     text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_auth_user_id UUID;
  v_previous_status public.product_status;
BEGIN
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  SELECT status INTO v_previous_status
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF v_previous_status IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.products
  SET deleted_at = now(),
      status = 'hidden'::public.product_status,
      updated_at = now()
  WHERE id = p_product_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    'PRODUCT_SOFT_DELETE',
    p_product_id,
    jsonb_build_object('reason', p_reason, 'previous_status', v_previous_status::text)
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_update_user_status (
  p_target_user_id uuid,
  p_new_status     public.account_status,
  p_reason         text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$

DECLARE
    v_auth_user_id UUID;
    v_previous_status public.account_status;
BEGIN
    -- A. SECURITY: the actor is the authenticated JWT subject
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- B. ROLE CHECK: active admins only
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    IF p_target_user_id = v_auth_user_id THEN
        RAISE EXCEPTION 'CANNOT_CHANGE_OWN_STATUS';
    END IF;

    -- A NULL status reads as active everywhere, so it would silently lift bans and holds
    IF p_new_status IS NULL THEN
        RAISE EXCEPTION 'INVALID_ACCOUNT_STATUS';
    END IF;

    -- C. LOCK TARGET: serialize concurrent status changes for the same account
    SELECT COALESCE(status, 'active')
    INTO v_previous_status
    FROM public.profiles_private
    WHERE id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Banned is final; same-status updates only refresh reason and audit
    IF v_previous_status = 'banned' AND p_new_status <> 'banned' THEN
        RAISE EXCEPTION 'BANNED_IS_FINAL';
    END IF;

    UPDATE public.profiles_private
    SET status = p_new_status,
        status_reason = p_reason,
        status_updated_by = v_auth_user_id::text,
        status_updated_at = now()
    WHERE id = p_target_user_id;

    -- D. INVENTORY: hold listings and remember their prior status
    IF p_new_status IN ('suspended', 'banned') THEN
        UPDATE public.products
        SET status_before_account_hold = COALESCE(status_before_account_hold, status),
            status = 'hidden'::public.product_status,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND deleted_at IS NULL
        AND status = ANY(ARRAY['verified', 'pending_verification', 'in_review']::public.product_status[]);

    -- Lifting a suspension restores only listings this hold hid; other hidden listings stay hidden
    ELSIF p_new_status = 'active' AND v_previous_status = 'suspended' THEN
        UPDATE public.products
        SET status = status_before_account_hold,
            status_before_account_hold = NULL,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'hidden'::public.product_status
        AND status_before_account_hold IS NOT NULL
        AND deleted_at IS NULL;

        -- Listings an admin moved out of hidden during the suspension keep no stale hold
        UPDATE public.products
        SET status_before_account_hold = NULL
        WHERE seller_id = p_target_user_id
        AND status_before_account_hold IS NOT NULL
        AND status <> 'hidden'::public.product_status;
    END IF;

    -- E. ADMIN AUDIT LOG
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_STATUS_UPDATE', p_target_user_id,
           jsonb_build_object('previous_status', v_previous_status::text, 'new_status', p_new_status::text, 'reason', p_reason));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_update_user_status', jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_close_account (
  p_user_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_status public.account_status;
  v_customer_id text;
  v_account_id text;
  v_closure internal.account_closures%ROWTYPE;
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
  SELECT * INTO v_closure FROM internal.account_closures WHERE user_id = p_user_id;
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
      AND p.status IN ('reserved', 'in_dispute')
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
  -- sale unless already sold.
  UPDATE public.products SET deleted_at = now(), status = 'hidden',
    status_before_account_hold = NULL, updated_at = now()
  WHERE seller_id = p_user_id
    AND deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi WHERE oi.product_id = products.id
    );
  UPDATE public.products SET status = 'hidden',
    status_before_account_hold = NULL, updated_at = now()
  WHERE seller_id = p_user_id
    AND deleted_at IS NULL
    AND status NOT IN ('sold', 'hidden');

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
  INSERT INTO internal.account_closures (
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_shipments_from_single_payment (
  p_stripe_payment_intent_id text,
  p_stripe_charge_id         text,
  p_amount_received          bigint,
  p_transfer_group           text,
  p_allocation               jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_buyer_id UUID;
  v_address_id UUID;
  v_order_id UUID;
  v_total_amount_cents BIGINT;
  v_addr_snapshot JSONB;
  v_existing_order RECORD;
  v_existing_order_id UUID;
  v_settled_shipment_count INT;
  v_is_new_order BOOLEAN := false;
  v_row JSONB;
  v_seller_id UUID;
  v_shipment_id UUID;
  v_product_ids UUID[];
  v_gross_cents BIGINT;
  v_commission_cents BIGINT;
  v_shipping_cents BIGINT;
  v_net_cents BIGINT;
  v_product_record RECORD;
  v_expected_product_count INT;
  v_found_product_count INT;
  v_reserved_product_count INT;
  v_item_limit INT;
  v_item_index INT;
  v_item_commission_cents BIGINT;
  v_item_shipping_cents BIGINT;
  v_item_net_cents BIGINT;
  v_residual_commission_cents BIGINT := 0;
  v_residual_shipping_cents BIGINT := 0;
  v_residual_net_cents BIGINT := 0;
  v_service_fee_amount_cents BIGINT := 0;
  v_failure_code TEXT;
BEGIN
  -- 1. Validate + extract structured allocation payload fields.
  v_buyer_id := (p_allocation ->> 'buyer_id')::UUID;
  v_address_id := NULLIF(p_allocation ->> 'address_id', '')::UUID;
  v_order_id := COALESCE(
    NULLIF(p_allocation ->> 'order_id', '')::UUID,
    NULLIF(p_allocation ->> 'order_group_id', '')::UUID
  );
  v_total_amount_cents := p_amount_received;

  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'BUYER_ID_REQUIRED';
  END IF;
  IF v_address_id IS NULL THEN
    RAISE EXCEPTION 'ADDRESS_ID_REQUIRED';
  END IF;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_ID_REQUIRED';
  END IF;

  -- 2. Address snapshot (validated against the buyer) — persisted on the shell.
  SELECT to_jsonb(a.*) INTO v_addr_snapshot
  FROM public.addresses a
  WHERE a.id = v_address_id
    AND a.user_id = v_buyer_id;
  IF v_addr_snapshot IS NULL THEN
    RAISE EXCEPTION 'ADDRESS_NOT_FOUND_OR_UNAUTHORIZED';
  END IF;

  -- 3. Idempotency: locate an existing order row for this PI id.
  SELECT id, payment_processing INTO v_existing_order
  FROM public.orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND buyer_id = v_buyer_id
  FOR UPDATE;

  IF v_existing_order.id IS NOT NULL THEN
    -- Count settled shipments tied to the shell. If any exist, the prior
    -- attempt fully succeeded — return duplicate WITHOUT any re-write.
    SELECT COUNT(*) INTO v_settled_shipment_count
    FROM public.shipments
    WHERE order_id = v_existing_order.id;

    IF v_settled_shipment_count > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', v_existing_order.id,
        'status', 'duplicate'
      );
    END IF;

    -- Prior attempt crashed mid-allocation. Re-use the shell id and re-attempt
    -- the allocation into the SAME order row (idempotent shipment insert below).
    v_existing_order_id := v_existing_order.id;

    -- Re-seed the shell's settlement identifiers in case the prior crash left
    -- them NULL (e.g. the shell was created by an even-earlier failure path).
    UPDATE public.orders
    SET stripe_charge_id = p_stripe_charge_id,
        stripe_transfer_group = p_transfer_group,
        payment_processing = false,
        payment_processing_reason = NULL,
        updated_at = now()
    WHERE id = v_existing_order_id;
  END IF;

  -- 4. Create the order shell (or re-use the recovered one) BEFORE the
  --    allocation attempt so a failed allocation leaves a recoverable row.
  --    status='pending' (NOT 'paid'); payment_processing=false until/if the
  --    inner allocation block raises.
  IF v_existing_order_id IS NULL THEN
    v_is_new_order := true;
    INSERT INTO public.orders (
      id,
      buyer_id,
      status,
      stripe_payment_intent_id,
      stripe_charge_id,
      stripe_transfer_group,
      payment_processing,
      service_fee_amount_cents,
      total_amount_cents,
      shipping_address
    ) VALUES (
      v_order_id,
      v_buyer_id,
      'pending',
      p_stripe_payment_intent_id,
      p_stripe_charge_id,
      p_transfer_group,
      false,
      0,
      v_total_amount_cents,
      v_addr_snapshot
    )
    RETURNING id INTO v_existing_order_id;
  ELSE
    v_order_id := v_existing_order_id;
  END IF;

  -- 5. Allocation block: shipments + order_items + product sold. Any failure
  --    here rolls back ONLY this block (the shell above survives) and is
  --    caught, marking the shell payment_processing=true for admin recovery.
  BEGIN
    -- Include numeric aggregation in the recovery boundary: malformed
    -- commission data must leave a durable payment_processing shell too.
    SELECT COALESCE(SUM((r->>'commission_cents')::BIGINT), 0)
      INTO v_service_fee_amount_cents
    FROM jsonb_array_elements(p_allocation -> 'rows') AS r;

    FOR v_row IN
      SELECT * FROM jsonb_array_elements(p_allocation -> 'rows')
    LOOP
      v_seller_id := (v_row ->> 'seller_id')::UUID;
      v_shipment_id := (v_row ->> 'shipment_id')::UUID;
      v_gross_cents := (v_row ->> 'gross_cents')::BIGINT;
      v_commission_cents := (v_row ->> 'commission_cents')::BIGINT;
      v_shipping_cents := (v_row ->> 'shipping_cents')::BIGINT;
      v_net_cents := (v_row ->> 'net_cents')::BIGINT;

      SELECT array_agg(pid::UUID) INTO v_product_ids
      FROM jsonb_array_elements_text(v_row -> 'product_ids') AS pid;

      IF v_product_ids IS NULL OR array_length(v_product_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'PRODUCT_IDS_REQUIRED';
      END IF;

      IF array_length(v_product_ids, 1) <> 1 THEN
        RAISE EXCEPTION 'ONE_PRODUCT_PER_SHIPMENT_REQUIRED';
      END IF;

      v_expected_product_count := array_length(v_product_ids, 1);

      SELECT COUNT(*) INTO v_found_product_count
      FROM public.products
      WHERE id = ANY(v_product_ids)
        AND seller_id = v_seller_id;

      IF v_found_product_count <> v_expected_product_count THEN
        RAISE EXCEPTION 'PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED';
      END IF;

      SELECT COUNT(*) INTO v_reserved_product_count
      FROM public.products
      WHERE id = ANY(v_product_ids)
        AND seller_id = v_seller_id
        AND status = 'reserved';

      IF v_reserved_product_count <> v_expected_product_count THEN
        RAISE EXCEPTION 'PRODUCT_NOT_RESERVED';
      END IF;

      -- Seed the shipment in a sub-pending state; only advanced to 'paid'
      -- AFTER all order_items for the row are persisted. The deterministic
      -- shipment id is the source of truth — ON CONFLICT DO NOTHING keeps a
      -- recovered re-attempt from duplicating a partially-written shipment.
      INSERT INTO public.shipments (
        id,
        order_id,
        seller_id,
        status,
        stripe_payment_intent_id,
        shipping_cost_cents
      ) VALUES (
        v_shipment_id,
        v_existing_order_id,
        v_seller_id,
        'preparing',
        p_stripe_payment_intent_id,
        v_shipping_cents
      )
      ON CONFLICT (id) DO NOTHING;

      -- Distribute the seller-level commission/shipping/net across the row's
      -- products proportionally by price, with the LAST product absorbing the
      -- residual so SUM(items) reconciles EXACTLY to the seller row. The
      -- allocator upfront guarantees gross = commission + shipping + net at the
      -- seller level; we preserve that invariant per-seller, not per-item.
      -- Every amount is integer cents; each share rounds to the nearest cent.
      v_item_limit := v_expected_product_count;
      v_residual_commission_cents := v_commission_cents;
      v_residual_shipping_cents := v_shipping_cents;
      v_residual_net_cents := v_net_cents;

      v_item_index := 0;
      FOR v_product_record IN
        SELECT id, price_cents
        FROM public.products
        WHERE id = ANY(v_product_ids)
          AND seller_id = v_seller_id
          AND status = 'reserved'
        ORDER BY id
        FOR UPDATE
      LOOP
        v_item_index := v_item_index + 1;
        IF v_item_index = v_item_limit THEN
          -- Last item: absorb the exact residual so the row sums reconcile.
          v_item_commission_cents := v_residual_commission_cents;
          v_item_shipping_cents := v_residual_shipping_cents;
          v_item_net_cents := v_residual_net_cents;
        ELSE
          v_item_commission_cents := round(
            v_commission_cents::NUMERIC * v_product_record.price_cents / v_gross_cents
          )::BIGINT;
          v_item_shipping_cents := round(
            v_shipping_cents::NUMERIC * v_product_record.price_cents / v_gross_cents
          )::BIGINT;
          v_item_net_cents := round(
            v_net_cents::NUMERIC * v_product_record.price_cents / v_gross_cents
          )::BIGINT;
          v_residual_commission_cents := v_residual_commission_cents - v_item_commission_cents;
          v_residual_shipping_cents := v_residual_shipping_cents - v_item_shipping_cents;
          v_residual_net_cents := v_residual_net_cents - v_item_net_cents;
        END IF;

        INSERT INTO public.order_items (
          order_id,
          shipment_id,
          seller_id,
          product_id,
          price_at_purchase_cents,
          commission_amount_cents,
          shipping_amount_cents,
          shipping_payer,
          net_payout_cents
        ) VALUES (
          v_existing_order_id,
          v_shipment_id,
          v_seller_id,
          v_product_record.id,
          v_product_record.price_cents,
          v_item_commission_cents,
          v_item_shipping_cents,
          'seller',
          v_item_net_cents
        )
        ON CONFLICT DO NOTHING;
      END LOOP;

      -- Mark the row's reserved products sold only after their order_items
      -- are durably persisted (preserves the spec invariant).
      UPDATE public.products
      SET status = 'sold', updated_at = now()
      WHERE id = ANY(v_product_ids)
        AND seller_id = v_seller_id
        AND status = 'reserved';

      -- Advance THIS shipment to 'paid' now that its allocation is durable.
      UPDATE public.shipments
      SET status = 'paid', updated_at = now()
      WHERE id = v_shipment_id
        AND status = 'preparing';
    END LOOP;

    -- All shipments are durable; pin the order's fee tally and derive status.
    UPDATE public.orders
    SET service_fee_amount_cents = COALESCE(v_service_fee_amount_cents, 0),
        total_amount_cents = v_total_amount_cents,
        updated_at = now()
    WHERE id = v_existing_order_id;

    PERFORM internal.fn_derive_order_status(v_existing_order_id);

    -- Derivation alone is not proof of full allocation: check every persisted
    -- shipment and the expected row count before publishing the paid event.
    SELECT COUNT(*) INTO v_settled_shipment_count
    FROM public.shipments s
    WHERE s.order_id = v_existing_order_id;
    IF v_settled_shipment_count = 0
       OR v_settled_shipment_count <> jsonb_array_length(p_allocation -> 'rows')
       OR EXISTS (
         SELECT 1 FROM public.shipments s
         WHERE s.order_id = v_existing_order_id AND s.status <> 'paid'
       ) THEN
      RAISE EXCEPTION 'INCOMPLETE_PAID_ALLOCATION';
    END IF;

    -- Union deduplicates the buyer if they are also a shipment seller.
    -- Both the recipients and the order identity come from persisted rows.
    INSERT INTO public.notifications (
      user_id, event_kind, source_event_key, event_payload,
      type, title, message, action_path
    )
    SELECT recipients.user_id,
           'order.payment_confirmed',
           'order.payment_confirmed:' || v_existing_order_id::text,
           jsonb_build_object('order_id', v_existing_order_id, 'recipient_role',
             CASE WHEN recipients.user_id = o.buyer_id THEN 'buyer' ELSE 'seller' END),
           'success',
           CASE WHEN recipients.user_id = o.buyer_id THEN 'Compra confirmada'
                ELSE 'Nueva venta confirmada' END,
           CASE WHEN recipients.user_id = o.buyer_id THEN 'Tu pago fue confirmado.'
                ELSE 'Recibiste una nueva venta.' END,
           '/profile/orders/' || o.id::text
    FROM public.orders o
    CROSS JOIN LATERAL (
      SELECT o.buyer_id AS user_id
      UNION
      SELECT DISTINCT s.seller_id AS user_id
      FROM public.shipments s
      WHERE s.order_id = v_existing_order_id
    ) recipients
    WHERE o.id = v_existing_order_id
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    -- Clear any prior recovery flag: this attempt fully settled.
    UPDATE public.orders
    SET payment_processing = false,
        payment_processing_reason = NULL,
        stripe_charge_id = p_stripe_charge_id,
        stripe_transfer_group = p_transfer_group
    WHERE id = v_existing_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_existing_order_id,
      'status', 'created'
    );
  EXCEPTION WHEN OTHERS THEN
    -- Allocation write failed. The inner block is rolled back (no shipment/
    -- order_item/sold writes persist); the shell above survives. Surface it
    -- to admin ops recovery: status stays 'pending' with payment_processing.
    v_failure_code := CASE
      WHEN SQLERRM IN (
        'ONE_PRODUCT_PER_SHIPMENT_REQUIRED',
        'PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED',
        'PRODUCT_NOT_RESERVED'
      ) OR SQLERRM LIKE 'INVALID_%' THEN SQLERRM
      ELSE 'SETTLEMENT_TRANSIENT_FAILURE'
    END;

    UPDATE public.orders
    SET payment_processing = true,
        payment_processing_reason = v_failure_code,
        stripe_charge_id = COALESCE(p_stripe_charge_id, stripe_charge_id),
        stripe_transfer_group = COALESCE(p_transfer_group, stripe_transfer_group),
        updated_at = now()
    WHERE id = v_existing_order_id;

    RETURN jsonb_build_object(
      'success', false,
      'order_id', v_existing_order_id,
      'status', 'payment_processing',
      'error', SQLERRM,
      'failure_code', v_failure_code,
      'runtime_version', 'single_modal_settlement_v2'
    );
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_finalize_checkout_recovery (
  p_stripe_payment_intent_id text,
  p_stripe_refund_id         text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_order_id UUID;
BEGIN
  IF NULLIF(p_stripe_refund_id, '') IS NULL THEN
    RAISE EXCEPTION 'STRIPE_REFUND_ID_REQUIRED';
  END IF;

  -- Lock the order first, then its reserved products by UUID. The caller may
  -- invoke this only after Stripe has confirmed the refund identifier.
  SELECT id INTO v_order_id
  FROM public.orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    UPDATE internal.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = p_stripe_refund_id,
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    IF FOUND THEN
      RETURN jsonb_build_object('status', 'refunded', 'stripe_payment_intent_id', p_stripe_payment_intent_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM internal.checkout_recovery_shells
      WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
        AND compensation_state = 'refunded'
    ) THEN
      RETURN jsonb_build_object('status', 'duplicate', 'stripe_payment_intent_id', p_stripe_payment_intent_id);
    END IF;

    RAISE EXCEPTION 'CHECKOUT_RECOVERY_TARGET_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = v_order_id
      AND compensation_state = 'refunded'
  ) THEN
    UPDATE internal.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = COALESCE(stripe_refund_id, p_stripe_refund_id),
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    RETURN jsonb_build_object('status', 'duplicate', 'order_id', v_order_id);
  END IF;

  PERFORM p.id
  FROM public.products p
  JOIN public.order_items oi ON oi.product_id = p.id
  WHERE oi.order_id = v_order_id
    AND p.status = 'reserved'
  ORDER BY p.id
  FOR UPDATE;

  PERFORM public.fn_release_listings(
    ARRAY(SELECT oi.product_id FROM public.order_items oi WHERE oi.order_id = v_order_id),
    true,
    false
  );

  UPDATE public.orders
  SET status = 'refunded',
      payment_processing = false,
      payment_processing_reason = NULL,
      compensation_state = 'refunded',
      stripe_refund_id = p_stripe_refund_id,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = NULL,
      updated_at = now()
  WHERE id = v_order_id;

  RETURN jsonb_build_object('status', 'refunded', 'order_id', v_order_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_product_available (
  p_product_ids uuid[]
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  )
  SELECT
    f.user_id,
    'product.available',
    'product.available:' || p.id::text,
    jsonb_build_object('product_id', p.id, 'recipient_role', 'buyer'),
    '¡Ya puedes comprarlo!',
    p.name || ' ya está disponible en Selene.',
    'success',
    false,
    '/product/' || p.id::text
  FROM public.products p
  JOIN public.profiles_private pp ON pp.id = p.seller_id
  JOIN public.favorites f ON f.product_id = p.id
  WHERE p.id = ANY(p_product_ids)
    AND p.status = 'verified'
    AND p.deleted_at IS NULL
    AND pp.stripe_account_id IS NOT NULL
    AND pp.stripe_onboarding_status = 'complete'
    AND pp.status IS DISTINCT FROM 'suspended'
    AND pp.status IS DISTINCT FROM 'banned'
    AND f.user_id <> p.seller_id
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_notify_product_interest (
  p_product_id   uuid,
  p_favoriter_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_ready boolean;
  v_count integer;
  v_milestone integer;
  v_title text;
  v_lead text;
  v_follow_up text;
  v_action_path text;
BEGIN
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND deleted_at IS NULL;

  IF NOT FOUND OR v_product.seller_id = p_favoriter_id THEN
    RETURN;
  END IF;

  SELECT COALESCE(
    pp.stripe_account_id IS NOT NULL
      AND pp.stripe_onboarding_status = 'complete'
      AND pp.status IS DISTINCT FROM 'suspended'
      AND pp.status IS DISTINCT FROM 'banned',
    false
  )
  INTO v_ready
  FROM public.profiles_private pp
  WHERE pp.id = v_product.seller_id;

  IF v_product.status = 'pending_verification' THEN
    v_follow_up := ' Envía tus pruebas para empezar a venderlo.';
    v_action_path := '/verify/' || v_product.id::text;
  ELSIF v_product.status = 'in_review' THEN
    v_follow_up := ' Lo estamos revisando; te avisaremos al terminar.';
    v_action_path := '/profile/listings';
  ELSIF v_product.status = 'verified' AND NOT COALESCE(v_ready, false) THEN
    v_follow_up := ' Activa tus pagos para poder venderlo.';
    v_action_path := '/sell/onboarding';
  ELSE
    RETURN;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.favorites
  WHERE product_id = v_product.id
    AND user_id <> v_product.seller_id;

  v_milestone := CASE
    WHEN v_count >= 25 THEN 25
    WHEN v_count >= 10 THEN 10
    WHEN v_count >= 5 THEN 5
    WHEN v_count >= 1 THEN 1
  END;

  IF v_milestone IS NULL THEN
    RETURN;
  END IF;

  IF v_milestone = 1 THEN
    v_title := 'Tu producto genera interés';
    v_lead := 'Alguien guardó tu ' || v_product.name || ' en favoritos.';
  ELSE
    v_title := '¡Ya son ' || v_milestone::text || ' personas interesadas!';
    v_lead := v_milestone::text || ' personas guardaron tu ' || v_product.name || ' en favoritos.';
  END IF;

  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  )
  VALUES (
    v_product.seller_id,
    'product.interest',
    'product.interest:' || v_product.id::text || ':' || v_milestone::text,
    jsonb_build_object('product_id', v_product.id, 'recipient_role', 'seller', 'milestone', v_milestone),
    v_title,
    v_lead || v_follow_up,
    'info',
    false,
    v_action_path
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_product_seller_payment_readiness (
  p_product_ids uuid[]
)
  RETURNS TABLE (
    product_id              uuid,
    seller_accepts_payments boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  SELECT
    p.id,
    COALESCE(
      pp.stripe_account_id IS NOT NULL
        AND pp.stripe_onboarding_status = 'complete'
        AND pp.status IS DISTINCT FROM 'suspended'
        AND pp.status IS DISTINCT FROM 'banned',
      false
    )
  FROM public.products p
  LEFT JOIN public.profiles_private pp ON pp.id = p.seller_id
  WHERE p.id = ANY(p_product_ids[1:50])
    AND p.status = 'verified'
    AND p.deleted_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.fn_release_listings (
  p_product_ids   uuid[],
  p_only_reserved boolean,
  p_only_expired  boolean
)
  RETURNS SETOF uuid
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  PERFORM 1
  FROM public.profiles_private pp
  WHERE pp.id IN (
    SELECT s.seller_id
    FROM public.products s
    WHERE s.id = ANY(p_product_ids)
      AND (NOT p_only_reserved OR s.status = 'reserved')
      AND (NOT p_only_expired OR s.reserved_at < now() - interval '10 minutes')
  )
  ORDER BY pp.id
  FOR SHARE;

  RETURN QUERY
  UPDATE public.products AS p
  SET status = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN 'verified'::public.product_status
        ELSE 'hidden'::public.product_status
      END,
      status_before_account_hold = CASE
        WHEN COALESCE(pp.status, 'active') = 'active'
          THEN p.status_before_account_hold
        ELSE COALESCE(p.status_before_account_hold, 'verified'::public.product_status)
      END,
      updated_at = now(),
      reserved_at = NULL
  FROM public.products AS s
  LEFT JOIN public.profiles_private AS pp ON pp.id = s.seller_id
  WHERE s.id = p.id
    AND p.id = ANY(p_product_ids)
    AND (NOT p_only_reserved OR p.status = 'reserved')
    AND (NOT p_only_expired OR p.reserved_at < now() - interval '10 minutes')
  RETURNING p.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_reserve_products (
  p_buyer_id    uuid,
  p_product_ids uuid[]
)
  RETURNS TABLE (
    total_price_cents bigint,
    success           boolean,
    error_message     text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_count INT;
  v_sum BIGINT;
  v_reserved_ids UUID[];
BEGIN
  -- 0. DEFENSA: Carrito nulo o vacío (retorno inmediato en 0ms)
  IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
    RETURN QUERY SELECT 0::BIGINT, false, 'EMPTY_CART'::TEXT;
    RETURN;
  END IF;

  -- Banned buyers cannot purchase; suspended buyers keep their own purchases
  IF EXISTS (
    SELECT 1 FROM public.profiles_private pp
    WHERE pp.id = p_buyer_id AND pp.status = 'banned'
  ) THEN
    RETURN QUERY SELECT 0::BIGINT, false, 'ACCOUNT_RESTRICTED'::TEXT;
    RETURN;
  END IF;

  -- 1. LIMPIEZA IDEMPOTENTE: Recuperar reservas vencidas (> 10 min) de este carrito
  PERFORM public.fn_release_listings(p_product_ids, true, true);

  -- 2. SEGURO ANTI-DEADLOCK: Bloqueo determinístico en orden alfabético de UUID
  PERFORM 1
  FROM public.products
  WHERE id = ANY(p_product_ids)
  ORDER BY id
  FOR UPDATE;

  -- 3. RESERVA ATÓMICA: Solo productos verified que no sean del comprador
  --    ni de vendedores suspendidos o baneados
  WITH reserved AS (
    UPDATE public.products
    SET status = 'reserved',
        updated_at = now(),
        reserved_at = now()
    WHERE id = ANY(p_product_ids)
      AND status = 'verified'
      AND seller_id <> p_buyer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles_private pp
        WHERE pp.id = products.seller_id
          AND pp.status IN ('suspended', 'banned')
      )
    RETURNING id, price_cents
  )
  SELECT array_agg(id), COUNT(*), COALESCE(SUM(price_cents), 0)::BIGINT
    INTO v_reserved_ids, v_count, v_sum
  FROM reserved;

  -- 4. ALL-OR-NOTHING: Si no se reservó el 100% del carrito, revertir lo parcial
  IF v_count = cardinality(p_product_ids) THEN
    RETURN QUERY SELECT v_sum, true, NULL::TEXT;
  ELSE
    IF v_count > 0 THEN
      PERFORM public.fn_release_listings(v_reserved_ids, true, false);
    END IF;
    RETURN QUERY SELECT 0::BIGINT, false, 'SOME_PRODUCTS_UNAVAILABLE'::TEXT;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_resolve_product_verdict (
  p_product_id   uuid,
  p_verdict      text,
  p_public_note  text DEFAULT NULL::text,
  p_private_note text DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_auth_user_id UUID;
  v_locked_by UUID;
  v_lock_time TIMESTAMPTZ;
  v_seller_id UUID;
  v_product_name TEXT;
  v_status public.product_status;
  v_audit_id UUID;
  v_event_kind TEXT;
  v_notif_title TEXT;
  v_notif_msg TEXT;
  v_notif_type TEXT;
  v_action_path TEXT;
BEGIN
  -- 1. Extraer ID del Administrador desde la sesión segura del JWT
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  -- 2. Validar que el usuario sea realmente un administrador
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  -- 3. Cargar datos del producto y bloquear la fila para actualización
  SELECT p.locked_by, p.locked_at, p.seller_id, p.name, p.status
  INTO v_locked_by, v_lock_time, v_seller_id, v_product_name, v_status
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  -- 4. Validar concurrencia: que el bloqueo siga perteneciendo al administrador y no haya expirado (10 min)
  IF v_locked_by IS NULL OR v_locked_by IS DISTINCT FROM v_auth_user_id OR v_lock_time < (now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'LOCK_EXPIRED_OR_STOLEN';
  END IF;

  IF (p_verdict = 'APPROVE' AND v_status = 'verified')
     OR (p_verdict = 'REJECT' AND v_status = 'rejected') THEN
    UPDATE public.products
    SET locked_by = NULL,
        locked_at = NULL
    WHERE id = p_product_id;
    RETURN true;
  END IF;

  -- 5. Insertar Nota Privada de Inteligencia del Admin (Solo si fue proporcionada)
  IF p_private_note IS NOT NULL AND trim(p_private_note) <> '' THEN
    INSERT INTO public.admin_user_notes (user_id, admin_id, content)
    VALUES (v_seller_id, v_auth_user_id, trim(p_private_note));
  END IF;

  -- 6. Actualizar Estado del Producto y liberar el lock
  IF p_verdict = 'REJECT' THEN
    UPDATE public.products
    SET status = 'rejected'::public.product_status,
        rejection_reason = trim(p_public_note),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = now()
    WHERE id = p_product_id;
  ELSIF p_verdict = 'APPROVE' THEN
    UPDATE public.products
    SET status = 'verified'::public.product_status,
        rejection_reason = NULL,
        verified_at = now(),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = now()
    WHERE id = p_product_id;
  ELSE
    RAISE EXCEPTION 'INVALID_VERDICT_VALUE';
  END IF;

  -- 7. Registrar Log de Auditoría Administrativa (Corregido: p_product_id sin castear a texto)
  INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
  VALUES (
    v_auth_user_id,
    CASE WHEN p_verdict = 'REJECT' THEN 'PRODUCT_REJECT' ELSE 'PRODUCT_APPROVE' END,
    p_product_id, -- <-- FIX: Eliminamos el ::text para que coincida con el tipo UUID de la columna
    jsonb_build_object(
      'product_name', v_product_name,
      'seller_id', v_seller_id,
      'admin_note', trim(p_public_note),
      'verdict', p_verdict
    )
  )
  RETURNING id INTO v_audit_id;

  -- 8. Resolver textos dinámicos de la Notificación para el vendedor
  IF p_verdict = 'REJECT' THEN
    v_notif_title := 'Producto Rechazado';
    v_event_kind := 'product.rejected';
    v_notif_type := 'error';
    v_notif_msg := 'Tu producto "' || v_product_name || '" ha sido rechazado. Motivo: ' || COALESCE(trim(p_public_note), 'No especificado por el administrador.');
    v_action_path := '/verify/' || p_product_id::text;
  ELSE
    v_notif_title := 'Producto Verificado';
    v_action_path := '/product/' || p_product_id::text;
    IF p_public_note IS NOT NULL AND trim(p_public_note) <> '' THEN
      v_event_kind := 'product.approved_with_note';
      v_notif_type := 'warning';
      v_notif_msg := '¡Listo! Tu producto "' || v_product_name || '" ya está a la venta. Nota del administrador: ' || trim(p_public_note);
    ELSE
      v_event_kind := 'product.approved';
      v_notif_type := 'success';
      v_notif_msg := '¡Felicidades! Tu producto "' || v_product_name || '" ha sido aprobado por moderación.';
    END IF;
  END IF;

  -- 9. Insertar Notificación para el vendedor (Bypass seguro de RLS)
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    title, message, type, read, action_path
  ) VALUES (
    v_seller_id,
    v_event_kind,
    v_event_kind || ':' || p_product_id::text || ':' || v_audit_id::text,
    jsonb_build_object('product_id', p_product_id, 'recipient_role', 'seller'),
    v_notif_title,
    v_notif_msg,
    v_notif_type,
    false,
    v_action_path
  )
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_set_product_in_dispute()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_product_id UUID;
BEGIN
  IF NEW.shipment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT oi.product_id INTO v_product_id
  FROM public.shipments s
  JOIN public.order_items oi ON oi.shipment_id = s.id
  WHERE s.id = NEW.shipment_id
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.products
  SET status = 'in_dispute'::public.product_status,
      updated_at = now()
  WHERE id = v_product_id
    AND deleted_at IS NULL
    AND status NOT IN ('sold'::public.product_status, 'reserved'::public.product_status);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_tr_product_available_on_connect_complete()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  PERFORM public.fn_notify_product_available(
    ARRAY(
      SELECT p.id
      FROM public.products p
      WHERE p.seller_id = NEW.id
        AND p.status = 'verified'
        AND p.deleted_at IS NULL
    )
  );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_stats (
  target_user_id uuid
)
  RETURNS json
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  total_sold integer;
  avg_rating numeric;
  total_reviews integer;
begin
  -- Contar ventas (Productos con status 'sold'), via the public view
  select count(*) into total_sold
  from public.products_public
  where seller_id = target_user_id and status = 'sold';

  -- Calcular rating promedio y conteo
  select avg(rating), count(*) into avg_rating, total_reviews
  from public.reviews
  where seller_id = target_user_id;

  -- Devolver objeto JSON
  return json_build_object(
    'sales_count', total_sold,
    'rating_average', coalesce(avg_rating, 0), -- Si es null, devuelve 0
    'reviews_count', total_reviews
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_owner_verified_edit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF current_user <> 'authenticated'
    OR NEW.status IS DISTINCT FROM 'verified'
    OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'verified'
    OR (to_jsonb(NEW) - ARRAY['name', 'description', 'condition', 'usage', 'updated_at', 'fts'])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['name', 'description', 'condition', 'usage', 'updated_at', 'fts']) THEN
    RAISE EXCEPTION 'VERIFIED_EDIT_REQUIRES_REVIEW' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

SELECT cron.unschedule('purge-expired-reservations');

SELECT
  cron.schedule_in_database('purge-expired-reservations', '*/15 * * * *',
  'update public.products set status = ''verified'', reserved_at = null, updated_at = now() where status = ''reserved'' and reserved_at < now() - interval ''30 minutes''',
  'postgres', NULL, true);
