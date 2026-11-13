-- Move five server-only machinery tables from public to internal
-- (odd/tasks/internal-schema.md S3, T5): webhook_deliveries, account_closures,
-- connect_account_actionability, connect_account_events and
-- connect_payout_events. ALTER TABLE ... SET SCHEMA keeps their rows, indexes,
-- constraints, triggers, RLS and foreign keys
-- (shipment_tracking_events.webhook_delivery_id now references
-- internal.webhook_deliveries). The SQL functions that read or write them now
-- name internal.<table>; their bodies are otherwise unchanged. That includes
-- fn_get_connect_account_sync_state, fn_park_payout_run_from_fence and
-- fn_block_payout_run_for_account_actionability, re-created here with the
-- bodies of migrations 20261112023204, 20261112032835 and 20261112033607.
-- The Edge Functions that used the tables directly through PostgREST call four
-- new narrow RPCs instead: fn_claim_envia_webhook_delivery and
-- fn_mark_webhook_delivery (envia-webhook), fn_list_capped_account_closures and
-- fn_record_closure_cleanup_step (account-closure-cleanup and delete-account).
-- fn_claim_account_closures now returns its columns as a table instead of the
-- row type of a table PostgREST no longer exposes (same columns, same JSON).
-- Grant review: no role but the owner keeps a privilege on the five tables.
-- service_role loses its grants on webhook_deliveries and account_closures
-- (it already had none on the other three): every SQL path to them is now
-- SECURITY DEFINER, so fn_claim_account_closures and fn_record_closure_attempt
-- change from SECURITY INVOKER to SECURITY DEFINER. Each of the four new RPCs
-- and the two changed ones is SECURITY DEFINER with search_path '', requires the
-- service_role claim in its body, and grants EXECUTE to service_role only;
-- PUBLIC, anon and authenticated get nothing, and they have no USAGE on schema
-- internal. The append-only trigger functions stay in public and keep firing.
SET local check_function_bodies = off;

ALTER TABLE "public"."webhook_deliveries" SET SCHEMA "internal";

ALTER TABLE "public"."account_closures" SET SCHEMA "internal";

ALTER TABLE "public"."connect_account_actionability" SET SCHEMA "internal";

ALTER TABLE "public"."connect_account_events" SET SCHEMA "internal";

ALTER TABLE "public"."connect_payout_events" SET SCHEMA "internal";

REVOKE ALL ON TABLE "internal"."webhook_deliveries" FROM "service_role";

REVOKE ALL ON TABLE "internal"."account_closures" FROM "service_role";

COMMENT ON TABLE "internal"."webhook_deliveries" IS 'Inbox of provider webhook deliveries, one row per provider and delivery id. Only fn_claim_envia_webhook_delivery and fn_mark_webhook_delivery (SECURITY DEFINER) reach it.';

COMMENT ON TABLE "internal"."account_closures" IS 'One row per closed account. Written by fn_close_account; the delete-account Edge Function and its retry worker update the cleanup columns through fn_claim_account_closures, fn_record_closure_attempt and fn_record_closure_cleanup_step. Only those SECURITY DEFINER functions reach it.';

DROP FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer);

CREATE OR REPLACE FUNCTION public.fn_acquire_connect_account_refresh (
  p_stripe_account_id text,
  p_source_event_id   text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_trigger_created TIMESTAMPTZ;
  v_generation BIGINT;
BEGIN
  IF p_stripe_account_id IS NULL OR p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_STRIPE_ACCOUNT_ID';
  END IF;
  IF p_source_event_id IS NULL OR p_source_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_EVENT_ID';
  END IF;
  SELECT cae.stripe_created INTO v_trigger_created
  FROM internal.connect_account_events cae
  WHERE cae.stripe_event_id = p_source_event_id
    AND cae.stripe_account_id = p_stripe_account_id;
  IF v_trigger_created IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;

  -- The PK upsert serializes even two first-ever acquisitions. Overflow raises
  -- rather than wrapping. No run lock and no network operation in acquisition.
  INSERT INTO internal.connect_account_actionability (
    stripe_account_id, is_actionable, blocked_reason, stripe_created,
    source_event_id, refresh_generation, refresh_pending
  ) VALUES (
    p_stripe_account_id, FALSE, 'account_refresh_pending', v_trigger_created,
    p_source_event_id, 1, TRUE
  )
  ON CONFLICT (stripe_account_id) DO UPDATE
  SET refresh_generation = internal.connect_account_actionability.refresh_generation + 1,
      refresh_pending = TRUE,
      is_actionable = FALSE,
      blocked_reason = 'account_refresh_pending',
      source_event_id = EXCLUDED.source_event_id,
      stripe_created = EXCLUDED.stripe_created,
      updated_at = clock_timestamp()
  RETURNING refresh_generation INTO v_generation;

  -- Setting the bit FALSE also fences the existing SQL claim eligibility join,
  -- which reads is_actionable directly. Existing runs are not changed here.
  RETURN v_generation;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_connect_account_refresh"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_acquire_connect_account_refresh"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_acquire_connect_account_refresh"(text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_acquire_connect_account_refresh"(text, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_append_connect_payout_event (
  p_stripe_event_id             text,
  p_event_type                  text,
  p_stripe_payout_id            text,
  p_connect_payout_run_id       uuid,
  p_stripe_created              timestamp with time zone,
  p_observed_payout_status      text,
  p_failure_code                text                     DEFAULT NULL::text,
  p_failure_message             text                     DEFAULT NULL::text,
  p_failure_balance_transaction text                     DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_inserted BOOLEAN;
BEGIN
  IF p_event_type NOT IN (
    'payout.created',
    'payout.updated',
    'payout.paid',
    'payout.failed',
    'payout.canceled'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_PAYOUT_EVENT_TYPE';
  END IF;

  IF p_observed_payout_status NOT IN (
    'pending',
    'in_transit',
    'paid',
    'failed',
    'canceled'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_OBSERVED_PAYOUT_STATUS';
  END IF;

  INSERT INTO internal.connect_payout_events (
    stripe_event_id,
    event_type,
    stripe_payout_id,
    connect_payout_run_id,
    stripe_created,
    received_at,
    observed_payout_status,
    failure_code,
    failure_message,
    failure_balance_transaction
  ) VALUES (
    p_stripe_event_id,
    p_event_type,
    p_stripe_payout_id,
    p_connect_payout_run_id,
    p_stripe_created,
    now(),
    p_observed_payout_status,
    p_failure_code,
    p_failure_message,
    p_failure_balance_transaction
  )
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  RETURN COALESCE(v_inserted, FALSE);
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_append_connect_payout_event"(text, text, text, uuid, timestamp WITH time zone, text, text, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_append_connect_payout_event"(text, text, text, uuid, timestamp WITH time zone, text, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_append_connect_payout_event"(text, text, text, uuid, timestamp WITH time zone, text, text, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_append_connect_payout_event"(text, text, text, uuid, timestamp WITH time zone, text, text, text, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_claim_awaiting_balance_payout_run (
  p_lease_seconds integer DEFAULT 300
)
  RETURNS TABLE (
    run_id           uuid,
    actor_id         uuid,
    seller_id        uuid,
    amount_cents     integer,
    idempotency_key  text,
    shipment_ids     uuid[],
    claim_token      text,
    stage_version    integer,
    claim_expires_at timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_lease TIMESTAMPTZ;
  v_run_id UUID;
  v_actor_id UUID;
  v_seller_id UUID;
  v_amount INTEGER;
  v_idempotency_key TEXT;
  v_shipment_ids UUID[];
  v_claim_token TEXT;
  v_stage_version INTEGER;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'INVALID_LEASE_SECONDS';
  END IF;

  v_lease := now() + make_interval(secs => p_lease_seconds);

  SELECT
    cpr.id,
    cpr.actor_id,
    cpr.seller_id,
    cpr.amount,
    cpr.idempotency_key,
    cpr.release_stage_version
  INTO
    v_run_id,
    v_actor_id,
    v_seller_id,
    v_amount,
    v_idempotency_key,
    v_stage_version
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  LEFT JOIN internal.connect_account_actionability caa
    ON caa.stripe_account_id = pp.stripe_account_id
  WHERE cpr.status = 'pending_reconciliation'
    AND cpr.stripe_payout_id IS NULL
    -- Only the executor-eligible pre-payout stage; a run fenced in
    -- payout_create_in_progress is reconciliation territory, never a second
    -- create.
    AND (
      cpr.release_stage = 'awaiting_connected_balance'
      OR cpr.release_stage IS NULL
    )
    -- Derived actionability: an account evidencing a documented non-actionable
    -- state (errored, verification_failed,
    -- tokenized_account_number_deactivated, payouts_disabled) is never
    -- claimed; unevidenced accounts default to actionable.
    AND COALESCE(caa.is_actionable, TRUE)
    -- Deferred runs stay deferred until their next attempt is due.
    AND (
      cpr.next_attempt_at IS NULL
      OR cpr.next_attempt_at <= now()
    )
    -- Absent or expired lease only; an actively leased run is never handed to
    -- a second worker.
    AND (
      cpr.payout_claim_expires_at IS NULL
      OR cpr.payout_claim_expires_at <= now()
    )
    AND EXISTS (
      SELECT 1
      FROM public.connect_payout_run_shipments m
      WHERE m.run_id = cpr.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.connect_payout_run_shipments m
      JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = cpr.id
        AND (
          m.status <> 'pending_reconciliation'
          OR s.stripe_transfer_id IS NULL
        )
    )
  -- Fair scheduling across all due candidates: order by each run's readiness
  -- instant — a never-deferred arrival became ready at created_at, a
  -- deferred run becomes ready again at next_attempt_at — so a due deferred
  -- run is claimed ahead of any newer arrival whose backoff has not been
  -- waiting as long. FIFO within the same readiness time. Prioritizing
  -- never-deferred arrivals ahead of due deferred runs (the legacy
  -- nulls-first ordering) would permanently starve due deferred runs under
  -- sustained arrivals. Not-yet-due runs are excluded by the WHERE gate
  -- above; a just-deferred run is not claimable again in the same tick
  -- because its backoff (minimum one minute) sets next_attempt_at in the
  -- future.
  ORDER BY COALESCE(cpr.next_attempt_at, cpr.created_at), cpr.created_at
  FOR UPDATE OF cpr SKIP LOCKED
  LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.connect_payout_runs
  SET payout_claim_token = gen_random_uuid()::text,
      payout_claim_expires_at = v_lease,
      -- Legacy admission: normalize a pre-fencing run into the stage model
      -- under the claim it just received.
      release_stage = COALESCE(release_stage, 'awaiting_connected_balance'),
      -- Every claim mints a new fencing epoch: the unconditional version
      -- bump invalidates any write an earlier claim holder could still be
      -- about to make, so a re-claimed lease can never reuse the previous
      -- token+version pair.
      release_stage_version = release_stage_version + 1,
      updated_at = now()
  WHERE id = v_run_id
  RETURNING payout_claim_token, release_stage_version
    INTO v_claim_token, v_stage_version;

  SELECT array_agg(m.shipment_id ORDER BY m.shipment_id)
  INTO v_shipment_ids
  FROM public.connect_payout_run_shipments m
  WHERE m.run_id = v_run_id;

  RETURN QUERY SELECT
    v_run_id,
    v_actor_id,
    v_seller_id,
    v_amount,
    v_idempotency_key,
    v_shipment_ids,
    v_claim_token,
    v_stage_version,
    v_lease;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) IS 'Claims one awaiting-balance payout run (pending_reconciliation, no Stripe payout id, awaiting_connected_balance or legacy stage, actionable account, next attempt due, unclaimed or expired lease, every shipment already transferred) under a short FOR UPDATE SKIP LOCKED lease and returns the DB-derived run fields plus the fresh claim token and the stage version the claim just bumped, which fence every worker write. Every claim mints a new fencing epoch by bumping the version. All due candidates (due deferred and immediate) are fairly ordered by readiness time so deferred runs cannot starve under sustained arrivals. Server-only; execution is restricted to service_role.';

REVOKE ALL ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"(integer) FROM PUBLIC, "anon", "authenticated";

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

GRANT EXECUTE ON FUNCTION "public"."fn_close_account"(uuid) TO "service_role";

COMMENT ON FUNCTION "public"."fn_close_account"(uuid) IS 'Service-only (SECURITY DEFINER): anonymizes and closes an account in one transaction, or returns a blocked reason with no change. Idempotent: a second call returns already_closed.';

REVOKE ALL ON FUNCTION "public"."fn_close_account"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_close_account"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_close_account"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_commit_connect_account_refresh (
  p_stripe_account_id               text,
  p_expected_generation             bigint,
  p_source_event_id                 text,
  p_is_actionable                   boolean,
  p_blocked_reason                  text,
  p_payouts_enabled                 boolean,
  p_current_external_account_id     text,
  p_current_external_account_status text,
  p_current_currency                text,
  p_current_default_for_currency    boolean,
  p_mxn_default_count               integer
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_has_destination BOOLEAN;
  v_actionable BOOLEAN := FALSE;
  v_blocked_reason TEXT := 'destination_undetermined';
  v_projected TEXT;
BEGIN
  IF p_stripe_account_id IS NULL OR p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_STRIPE_ACCOUNT_ID';
  END IF;
  IF p_source_event_id IS NULL OR p_source_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_EVENT_ID';
  END IF;
  IF p_expected_generation IS NULL OR p_expected_generation <= 0 THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM internal.connect_account_events cae
    WHERE cae.stripe_event_id = p_source_event_id
      AND cae.stripe_account_id = p_stripe_account_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;

  v_has_destination := COALESCE(
    p_mxn_default_count = 1
    AND p_current_external_account_id ~ '^ba_[A-Za-z0-9]+$'
    AND p_current_currency = 'mxn'
    AND p_current_default_for_currency IS TRUE,
    FALSE
  );
  IF p_mxn_default_count IS NOT NULL AND p_mxn_default_count < 0 THEN
    RAISE EXCEPTION 'INVALID_CURRENT_ACCOUNT_SNAPSHOT';
  END IF;
  IF NOT v_has_destination AND (
    p_current_external_account_id IS NOT NULL
    OR p_current_external_account_status IS NOT NULL
    OR p_current_currency IS NOT NULL
    OR p_current_default_for_currency IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_CURRENT_ACCOUNT_SNAPSHOT';
  END IF;

  -- Reconstruct the gate rather than trusting a service-role healthy bit.
  -- Only explicit true plus one known healthy MXN default can enable payouts.
  IF p_payouts_enabled IS FALSE THEN
    v_blocked_reason := 'payouts_disabled';
  ELSIF v_has_destination AND p_current_external_account_status IN (
    'errored', 'verification_failed', 'tokenized_account_number_deactivated'
  ) THEN
    v_blocked_reason := p_current_external_account_status;
  ELSIF p_payouts_enabled IS TRUE AND v_has_destination
    AND p_current_external_account_status IN ('new', 'validated', 'verified') THEN
    v_actionable := TRUE;
    v_blocked_reason := NULL;
  END IF;
  IF p_is_actionable IS DISTINCT FROM v_actionable
    OR p_blocked_reason IS DISTINCT FROM v_blocked_reason THEN
    RAISE EXCEPTION 'INVALID_CURRENT_ACCOUNT_SNAPSHOT';
  END IF;

  -- Atomic CAS acquires the account lock BEFORE any run projection. A replay
  -- of an already accepted generation, superseded read, or wrong trigger loses
  -- without clearing another refresh's pending flag. No Stripe timestamp gate.
  UPDATE internal.connect_account_actionability caa
  SET is_actionable = v_actionable,
      blocked_reason = v_blocked_reason,
      payouts_enabled = p_payouts_enabled,
      external_account_status = p_current_external_account_status,
      current_external_account_id = p_current_external_account_id,
      current_currency = p_current_currency,
      current_default_for_currency = p_current_default_for_currency,
      current_mxn_default_count = p_mxn_default_count,
      current_observed_at = clock_timestamp(),
      refresh_pending = FALSE,
      updated_at = clock_timestamp()
  WHERE caa.stripe_account_id = p_stripe_account_id
    AND caa.refresh_generation = p_expected_generation
    AND caa.refresh_pending IS TRUE
    AND caa.source_event_id = p_source_event_id
  RETURNING caa.stripe_account_id INTO v_projected;
  IF v_projected IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Lock relevant runs in ID order after the account row. Claim RPCs lock only
  -- runs and read the account via MVCC (no reverse account lock), so there is
  -- no account/run lock cycle. No lock survives this short RPC transaction.
  PERFORM cpr.id
  FROM public.connect_payout_runs cpr
  WHERE cpr.seller_id IN (
    SELECT pp.id FROM public.profiles_private pp
    WHERE pp.stripe_account_id = p_stripe_account_id
  )
    AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed')
    AND cpr.stripe_payout_id IS NULL
    AND (
      (v_actionable AND cpr.release_stage = 'action_required'
        AND cpr.action_required_reason = 'account_not_actionable')
      OR (NOT v_actionable
        AND cpr.action_required_reason IS DISTINCT FROM 'account_not_actionable'
        AND (cpr.release_stage IN (
          'release_accepted', 'transfer_created', 'awaiting_connected_balance'
        ) OR cpr.release_stage IS NULL))
    )
  ORDER BY cpr.id
  FOR UPDATE OF cpr;

  IF v_actionable THEN
    -- Exact reason-gated pre-payout resume only. The explicit status gate also
    -- excludes a failed parent even if its park reason/stage survived a failure.
    UPDATE public.connect_payout_runs cpr
    SET release_stage = 'awaiting_connected_balance',
        release_stage_version = cpr.release_stage_version + 1,
        status = CASE WHEN cpr.status = 'reconciliation_needed'
          THEN 'pending_reconciliation' ELSE cpr.status END,
        action_required_reason = NULL,
        last_error = NULL,
        next_attempt_at = NULL,
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
    WHERE cpr.seller_id IN (
      SELECT pp.id FROM public.profiles_private pp
      WHERE pp.stripe_account_id = p_stripe_account_id
    )
      AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed')
      AND cpr.action_required_reason = 'account_not_actionable'
      AND cpr.release_stage = 'action_required'
      AND cpr.stripe_payout_id IS NULL;
  ELSE
    -- Runs fenced in payout_create_in_progress are never parked by webhook
    -- projection. Only their live claim owner/terminal reconciliation can exit
    -- that fence via the existing narrowly guarded RPCs, unchanged here.
    UPDATE public.connect_payout_runs cpr
    SET release_stage = 'action_required',
        release_stage_version = cpr.release_stage_version + 1,
        status = CASE WHEN cpr.status = 'pending_reconciliation'
          THEN 'reconciliation_needed' ELSE cpr.status END,
        action_required_reason = 'account_not_actionable',
        last_error = 'account_not_actionable: ' || v_blocked_reason,
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
    WHERE cpr.seller_id IN (
      SELECT pp.id FROM public.profiles_private pp
      WHERE pp.stripe_account_id = p_stripe_account_id
    )
      AND cpr.stripe_payout_id IS NULL
      AND cpr.status IN ('pending_reconciliation', 'reconciliation_needed')
      AND cpr.action_required_reason IS DISTINCT FROM 'account_not_actionable'
      AND (cpr.release_stage IN (
        'release_accepted', 'transfer_created', 'awaiting_connected_balance'
      ) OR cpr.release_stage IS NULL);
  END IF;
  -- Acceptance is observable even if no eligible runs needed a change.
  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_commit_connect_account_refresh"(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_commit_connect_account_refresh"(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_commit_connect_account_refresh"(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer) TO "postgres";

REVOKE ALL
  ON FUNCTION "public"."fn_commit_connect_account_refresh"(text, bigint, text, boolean, text, boolean, text, text, text, boolean, integer)
  FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_get_connect_account_actionability (
  p_stripe_account_id text
)
  RETURNS TABLE (
    is_actionable  boolean,
    blocked_reason text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  IF p_stripe_account_id IS NULL OR btrim(p_stripe_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;
  RETURN QUERY
  SELECT
    CASE WHEN caa.refresh_pending THEN FALSE
      ELSE COALESCE(caa.is_actionable, TRUE) END,
    CASE WHEN caa.refresh_pending THEN 'account_refresh_pending'::TEXT
      ELSE caa.blocked_reason END
  FROM (SELECT 1) AS seed
  LEFT JOIN internal.connect_account_actionability caa
    ON caa.stripe_account_id = p_stripe_account_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_get_connect_account_actionability"(text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_get_connect_account_actionability"(text) IS 'RPC-only payout gate, pending refresh returns FALSE/account_refresh_pending, including after retrieval error. Existing no-row TRUE compatibility is preserved; existing blocked rows are never bulk-enabled.';

REVOKE ALL ON FUNCTION "public"."fn_get_connect_account_actionability"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_get_connect_account_actionability"(text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_get_connect_account_actionability"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_block_payout_run_for_account_actionability (
  p_run_id                 uuid,
  p_claim_token            text,
  p_expected_stage_version integer,
  p_blocked_reason         text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_account_id TEXT;
  v_refresh_pending BOOLEAN;
  v_is_actionable BOOLEAN;
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_payout_id TEXT;
BEGIN
  -- seller_id never changes on a run, so the account can be read before any
  -- lock is taken.
  SELECT pp.stripe_account_id
  INTO v_account_id
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  WHERE cpr.id = p_run_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- The worker read actionability without a lock. Lock the account row first,
  -- then the run: the same order as fn_commit_connect_account_refresh and
  -- fn_park_payout_run_from_fence, so they never deadlock. FOR SHARE blocks a
  -- refresh acquire or commit until this transaction ends, so the state read
  -- here is the state the run is parked or requeued under. A missing row (no
  -- refresh yet) counts as actionable, as in fn_get_connect_account_actionability.
  -- A seller without a Stripe account has no row to lock and is parked as before.
  IF v_account_id IS NOT NULL THEN
    SELECT caa.refresh_pending, caa.is_actionable
    INTO v_refresh_pending, v_is_actionable
    FROM internal.connect_account_actionability caa
    WHERE caa.stripe_account_id = v_account_id
    FOR SHARE;
  END IF;

  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token,
    cpr.payout_claim_expires_at, cpr.stripe_payout_id
  INTO v_stage, v_version, v_token, v_expires_at, v_payout_id
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  -- Only the live claim of the expected version may move the run, so a stale
  -- worker can never park or requeue a newer claim.
  IF v_token IS NULL OR v_token IS DISTINCT FROM p_claim_token
    OR v_version IS DISTINCT FROM p_expected_stage_version
    OR v_expires_at IS NULL OR v_expires_at <= now()
    OR v_payout_id IS NOT NULL
    OR v_stage IS NULL
    OR v_stage NOT IN ('awaiting_connected_balance', 'payout_create_in_progress') THEN
    RETURN FALSE;
  END IF;

  IF v_account_id IS NULL
    OR COALESCE(v_refresh_pending, FALSE)
    OR NOT COALESCE(v_is_actionable, TRUE) THEN
    UPDATE public.connect_payout_runs
    SET release_stage = 'action_required',
        release_stage_version = v_version + 1,
        status = CASE
          WHEN status = 'pending_reconciliation' THEN 'reconciliation_needed'
          ELSE status
        END,
        action_required_reason = 'account_not_actionable',
        last_error = 'account_not_actionable: ' || COALESCE(p_blocked_reason, 'unknown'),
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
      WHERE id = p_run_id;

    RETURN TRUE;
  END IF;

  -- The account became actionable after the worker's read (a refresh committed
  -- in between): requeue as fn_park_payout_run_from_fence does, so the worker
  -- claims the run again instead of leaving it parked until the next account
  -- event. Shipment mappings stay pending_reconciliation. A run inside its
  -- payout-create fence is never moved back to a create stage (that would undo
  -- the write-ahead fence against a second payout): it keeps its stage and
  -- claim, and the caller releases the claim.
  IF v_stage = 'payout_create_in_progress' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = 'awaiting_connected_balance',
      release_stage_version = v_version + 1,
      status = 'pending_reconciliation',
      action_required_reason = NULL,
      last_error = NULL,
      next_attempt_at = NULL,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id;

  RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_connect_account_sync_state (
  p_stripe_account_id text,
  p_stripe_event_ids  text[]
)
  RETURNS TABLE (
    refresh_pending             boolean,
    is_actionable               boolean,
    current_external_account_id text,
    recorded_event_count        integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  IF p_stripe_account_id IS NULL OR btrim(p_stripe_account_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;
  RETURN QUERY
  SELECT
    caa.refresh_pending,
    caa.is_actionable,
    caa.current_external_account_id,
    (SELECT count(*)::integer
       FROM internal.connect_account_events cae
      WHERE cae.stripe_account_id = p_stripe_account_id
        AND cae.stripe_event_id = ANY (COALESCE(p_stripe_event_ids, ARRAY[]::text[])))
  FROM (SELECT 1) AS seed
  LEFT JOIN internal.connect_account_actionability caa
    ON caa.stripe_account_id = p_stripe_account_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_park_payout_run_from_fence (
  p_run_id                 uuid,
  p_expected_stage_version integer
)
  RETURNS TABLE (
    outcome       text,
    stage_version integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_account_id TEXT;
  v_refresh_pending BOOLEAN;
  v_is_actionable BOOLEAN;
  v_blocked_reason TEXT;
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
  v_payout_id TEXT;
  v_status TEXT;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  -- seller_id never changes on a run, so the account can be read before any
  -- lock is taken.
  SELECT pp.stripe_account_id
  INTO v_account_id
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  WHERE cpr.id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_STRIPE_ACCOUNT_ID';
  END IF;

  -- Account row first, then the run: the same order as
  -- fn_commit_connect_account_refresh, so the two never deadlock. FOR SHARE
  -- blocks a refresh acquire or commit (both write the row) until this
  -- transaction ends, so the state read here is the state the run is parked
  -- or requeued under, while parks of other runs of the same account do not
  -- wait on each other. A missing row (no refresh yet) counts as actionable,
  -- as in fn_get_connect_account_actionability.
  SELECT caa.refresh_pending, caa.is_actionable, caa.blocked_reason
  INTO v_refresh_pending, v_is_actionable, v_blocked_reason
  FROM internal.connect_account_actionability caa
  WHERE caa.stripe_account_id = v_account_id
  FOR SHARE;

  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token,
    cpr.stripe_payout_id, cpr.status
  INTO v_stage, v_version, v_token, v_payout_id, v_status
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  -- Only the manual fence owner may exit this way: a held claim belongs to
  -- the worker, which exits through its own claim-conditioned RPCs.
  IF v_token IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUTOR_CLAIM_HELD';
  END IF;
  IF p_expected_stage_version IS NULL OR v_version <> p_expected_stage_version THEN
    RAISE EXCEPTION 'STAGE_VERSION_CONFLICT';
  END IF;
  IF v_stage IS DISTINCT FROM 'payout_create_in_progress'
    OR v_payout_id IS NOT NULL
    OR v_status <> 'pending_reconciliation' THEN
    RAISE EXCEPTION 'PAYOUT_CREATE_FENCE_CONFLICT';
  END IF;

  IF COALESCE(v_refresh_pending, FALSE) OR NOT COALESCE(v_is_actionable, TRUE) THEN
    -- Parked exactly as fn_block_payout_run_for_account_actionability parks,
    -- so an actionable fn_commit_connect_account_refresh resumes it. The
    -- mappings stay pending_reconciliation for the worker claim gate.
    UPDATE public.connect_payout_runs
    SET release_stage = 'action_required',
        release_stage_version = v_version + 1,
        status = 'reconciliation_needed',
        action_required_reason = 'account_not_actionable',
        last_error = 'account_not_actionable: ' || CASE
          WHEN COALESCE(v_refresh_pending, FALSE) THEN 'account_refresh_pending'
          ELSE COALESCE(v_blocked_reason, 'unknown')
        END,
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
      WHERE id = p_run_id;

    RETURN QUERY SELECT 'parked'::TEXT, v_version + 1;
    RETURN;
  END IF;

  -- The account became actionable before this lock (a refresh committed after
  -- the caller's check): requeue as the commit's resume does, so
  -- resume-pending-payouts creates the payout.
  UPDATE public.connect_payout_runs
  SET release_stage = 'awaiting_connected_balance',
      release_stage_version = v_version + 1,
      status = 'pending_reconciliation',
      action_required_reason = NULL,
      last_error = NULL,
      next_attempt_at = NULL,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id;

  RETURN QUERY SELECT 'requeued'::TEXT, v_version + 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_record_connect_account_event (
  p_stripe_event_id         text,
  p_stripe_account_id       text,
  p_event_type              text,
  p_stripe_created          timestamp with time zone,
  p_payouts_enabled         boolean                  DEFAULT NULL::boolean,
  p_external_account_status text                     DEFAULT NULL::text,
  p_external_account_id     text                     DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_inserted BOOLEAN;
  v_account_id TEXT;
BEGIN
  IF p_stripe_account_id IS NULL OR p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_STRIPE_ACCOUNT_ID';
  END IF;
  IF p_stripe_event_id IS NULL OR p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_EVENT_ID';
  END IF;
  IF p_event_type IS NULL OR p_event_type NOT IN (
    'account.updated', 'account.external_account.created',
    'account.external_account.updated', 'account.external_account.deleted'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_ACCOUNT_EVENT_TYPE';
  END IF;
  IF p_stripe_created IS NULL OR NOT isfinite(p_stripe_created) THEN
    RAISE EXCEPTION 'MISSING_STRIPE_CREATED';
  END IF;

  INSERT INTO internal.connect_account_events (
    stripe_event_id, stripe_account_id, event_type, stripe_created,
    payouts_enabled, external_account_status, external_account_id
  ) VALUES (
    p_stripe_event_id, p_stripe_account_id, p_event_type, p_stripe_created,
    p_payouts_enabled, p_external_account_status, p_external_account_id
  )
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING TRUE INTO v_inserted;

  IF v_inserted IS TRUE THEN
    RETURN TRUE;
  END IF;
  -- A second statement sees the winning concurrent insert at READ COMMITTED.
  -- If unavailable under another isolation level, reject rather than misbind.
  SELECT cae.stripe_account_id INTO v_account_id
  FROM internal.connect_account_events cae
  WHERE cae.stripe_event_id = p_stripe_event_id;
  IF v_account_id IS DISTINCT FROM p_stripe_account_id THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;
  RETURN FALSE;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_record_connect_account_event"(text, text, text, timestamp WITH time zone, boolean, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_record_connect_account_event"(text, text, text, timestamp WITH time zone, boolean, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_record_connect_account_event"(text, text, text, timestamp WITH time zone, boolean, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_record_connect_account_event"(text, text, text, timestamp WITH time zone, boolean, text, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_record_closure_attempt (
  p_user_id       uuid,
  p_last_error    text,
  p_count_attempt boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  UPDATE internal.account_closures
  SET attempts = attempts + CASE WHEN p_count_attempt THEN 1 ELSE 0 END,
      last_error = left(p_last_error, 500),
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) TO "service_role";

COMMENT ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) IS 'Service-only (SECURITY DEFINER): atomically adds one attempt (when p_count_attempt) and stamps last_error and updated_at on an account closure.';

REVOKE ALL ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_record_closure_attempt"(uuid, text, boolean) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_claim_account_closures (
  p_limit        integer,
  p_min_idle     interval,
  p_max_attempts integer
)
  RETURNS TABLE (
    user_id                 uuid,
    closed_at               timestamp with time zone,
    stripe_customer_id      text,
    stripe_account_id       text,
    stripe_customer_cleanup text,
    stripe_account_cleanup  text,
    storage_cleanup         text,
    attempts                integer,
    last_error              text,
    updated_at              timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_min_idle IS NULL OR p_min_idle < interval '0'
     OR p_max_attempts IS NULL OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  RETURN QUERY
  UPDATE internal.account_closures AS c
  SET attempts = c.attempts + 1,
      updated_at = now()
  WHERE c.user_id IN (
    SELECT a.user_id
    FROM internal.account_closures AS a
    WHERE (
        a.stripe_customer_cleanup IN ('pending', 'failed')
        OR a.stripe_account_cleanup IN ('pending', 'failed')
        OR a.storage_cleanup IN ('pending', 'failed')
      )
      AND a.attempts < p_max_attempts
      AND a.updated_at <= now() - p_min_idle
    ORDER BY a.updated_at, a.user_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING c.user_id, c.closed_at, c.stripe_customer_id, c.stripe_account_id,
    c.stripe_customer_cleanup, c.stripe_account_cleanup, c.storage_cleanup,
    c.attempts, c.last_error, c.updated_at;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) IS 'Service-only (SECURITY DEFINER): atomically claims up to p_limit closures with an open cleanup step, oldest first, adding one attempt each. Skips rows touched within p_min_idle and rows at p_max_attempts.';

REVOKE ALL ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_account_closures"(integer, interval, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_claim_envia_webhook_delivery (
  p_delivery_id    text,
  p_event_name     text,
  p_payload_sha256 text
)
  RETURNS TABLE (
    kind text,
    id   uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_id uuid;
  v_existing_sha256 text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_delivery_id IS NULL OR p_delivery_id = ''
     OR p_event_name IS NULL OR p_event_name = ''
     OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  INSERT INTO internal.webhook_deliveries AS d (provider, delivery_id, event_name, payload_sha256)
  VALUES ('envia', p_delivery_id, p_event_name, p_payload_sha256)
  ON CONFLICT (provider, delivery_id) DO NOTHING
  RETURNING d.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'new'::text, v_id;
    RETURN;
  END IF;

  -- A second statement sees the delivery that won the insert, even a concurrent one.
  SELECT d.payload_sha256 INTO v_existing_sha256
  FROM internal.webhook_deliveries AS d
  WHERE d.provider = 'envia' AND d.delivery_id = p_delivery_id;

  RETURN QUERY SELECT
    CASE WHEN v_existing_sha256 = p_payload_sha256 THEN 'duplicate' ELSE 'collision' END,
    NULL::uuid;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) IS 'Service-only (SECURITY DEFINER): records an Envia webhook delivery once. Returns kind new with the delivery id, or duplicate (same id and payload hash) or collision (same id, other payload hash) with no id and no change.';

REVOKE ALL ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_claim_envia_webhook_delivery"(text, text, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_mark_webhook_delivery (
  p_delivery_id uuid,
  p_state       text,
  p_error_code  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_delivery_id IS NULL
     OR p_state IS NULL OR p_state NOT IN ('processed', 'failed')
     OR (p_state = 'processed' AND p_error_code IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  IF p_state = 'processed' THEN
    UPDATE internal.webhook_deliveries
    SET state = 'processed',
        processed_at = now()
    WHERE id = p_delivery_id;
  ELSE
    UPDATE internal.webhook_deliveries
    SET state = 'failed',
        error_code = p_error_code
    WHERE id = p_delivery_id;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) IS 'Service-only (SECURITY DEFINER): marks a webhook delivery processed (stamps processed_at) or failed (records p_error_code). An unknown id changes nothing.';

REVOKE ALL ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_mark_webhook_delivery"(uuid, text, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_list_capped_account_closures (
  p_max_attempts integer,
  p_limit        integer
)
  RETURNS TABLE (
    user_id  uuid,
    attempts integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_max_attempts IS NULL OR p_max_attempts < 1
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  RETURN QUERY
  SELECT a.user_id, a.attempts
  FROM internal.account_closures AS a
  WHERE (
      a.stripe_customer_cleanup IN ('pending', 'failed')
      OR a.stripe_account_cleanup IN ('pending', 'failed')
      OR a.storage_cleanup IN ('pending', 'failed')
    )
    AND a.attempts >= p_max_attempts
  ORDER BY a.updated_at, a.user_id
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) TO "service_role";

COMMENT ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) IS 'Service-only (SECURITY DEFINER): lists up to p_limit closures with an open cleanup step and at least p_max_attempts attempts, oldest first, for the retry worker to report.';

REVOKE ALL ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_list_capped_account_closures"(integer, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_record_closure_cleanup_step (
  p_user_id uuid,
  p_step    text,
  p_state   text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_user_id IS NULL
     OR NOT (
       (p_step IN ('stripe_customer_cleanup', 'stripe_account_cleanup')
         AND p_state IN ('done', 'failed', 'not_needed'))
       OR (p_step = 'storage_cleanup' AND p_state IN ('done', 'failed'))
     ) THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  UPDATE internal.account_closures
  SET stripe_customer_cleanup = CASE WHEN p_step = 'stripe_customer_cleanup' THEN p_state ELSE stripe_customer_cleanup END,
      stripe_account_cleanup = CASE WHEN p_step = 'stripe_account_cleanup' THEN p_state ELSE stripe_account_cleanup END,
      storage_cleanup = CASE WHEN p_step = 'storage_cleanup' THEN p_state ELSE storage_cleanup END,
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) TO "service_role";

COMMENT ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) IS 'Service-only (SECURITY DEFINER): records the result of one cleanup step (Stripe customer, Stripe account or Storage) of an account closure and stamps updated_at. Does not count an attempt; an unknown user changes nothing.';

REVOKE ALL ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_record_closure_cleanup_step"(uuid, text, text) FROM PUBLIC, "anon", "authenticated";
