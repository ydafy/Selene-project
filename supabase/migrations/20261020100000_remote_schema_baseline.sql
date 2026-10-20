-- Schema baseline dumped from project acoiclkeymgtlwcxilun on 2026-10-20
-- with `supabase db dump --linked` (schema only, no data). Earlier history
-- lives in supabase/migrations/archive and must not be replayed.
--
-- Not included by the dump: pg_cron jobs, Vault secrets, Storage buckets,
-- Auth settings and Edge Function secrets. See docs/go-live.md.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "internal";


ALTER SCHEMA "internal" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "wrappers" WITH SCHEMA "extensions";






CREATE TYPE "public"."account_status" AS ENUM (
    'active',
    'suspended',
    'banned'
);


ALTER TYPE "public"."account_status" OWNER TO "postgres";


CREATE TYPE "public"."dispute_reason" AS ENUM (
    'damaged',
    'not_working',
    'wrong_item',
    'incomplete',
    'other'
);


ALTER TYPE "public"."dispute_reason" OWNER TO "postgres";


CREATE TYPE "public"."dispute_status" AS ENUM (
    'open',
    'under_review',
    'waiting_return',
    'resolved',
    'rejected',
    'return_shipped',
    'return_delivered'
);


ALTER TYPE "public"."dispute_status" OWNER TO "postgres";


CREATE TYPE "public"."order_status_enum" AS ENUM (
    'pending',
    'paid',
    'preparing',
    'shipped',
    'delivered',
    'completed',
    'cancelled',
    'dispute',
    'refunded'
);


ALTER TYPE "public"."order_status_enum" OWNER TO "postgres";


CREATE TYPE "public"."payout_status" AS ENUM (
    'pending',
    'processing',
    'completed',
    'rejected'
);


ALTER TYPE "public"."payout_status" OWNER TO "postgres";


CREATE TYPE "public"."product_status_enum" AS ENUM (
    'PENDING_VERIFICATION',
    'IN_REVIEW',
    'VERIFIED',
    'SOLD',
    'REJECTED',
    'HIDDEN',
    'RESERVED',
    'IN_DISPUTE'
);


ALTER TYPE "public"."product_status_enum" OWNER TO "postgres";


CREATE TYPE "public"."shipment_tracking_event_type" AS ENUM (
    'created',
    'information',
    'in_transit',
    'delivered',
    'exception',
    'returned'
);


ALTER TYPE "public"."shipment_tracking_event_type" OWNER TO "postgres";


CREATE TYPE "public"."stripe_onboarding_status" AS ENUM (
    'pending',
    'complete',
    'rejected'
);


ALTER TYPE "public"."stripe_onboarding_status" OWNER TO "postgres";


CREATE TYPE "public"."wallet_transaction_type" AS ENUM (
    'sale_proceeds',
    'payout',
    'refund',
    'adjustment',
    'release'
);


ALTER TYPE "public"."wallet_transaction_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."fn_check_order_access"("p_order_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN RETURN false; END IF;
    RETURN EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND buyer_id = v_user_id) 
           OR EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND seller_id = v_user_id) 
           OR internal.is_admin();
END; $$;


ALTER FUNCTION "internal"."fn_check_order_access"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."fn_check_order_access"("p_order_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        -- Regla 1: El usuario es el comprador de la orden
        SELECT 1 FROM public.orders WHERE id = p_order_id AND buyer_id = p_user_id
        UNION ALL
        -- Regla 2: El usuario es vendedor de algún artículo en la orden
        SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND seller_id = p_user_id
        UNION ALL
        -- Regla 3: Override de Administrador (Verifica directo en profiles_private)
        SELECT 1 FROM public.profiles_private WHERE id = p_user_id AND role = 'admin'
    );
END; $$;


ALTER FUNCTION "internal"."fn_check_order_access"("p_order_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."fn_save_bank_account"("p_clabe" "text", "p_holder_name" "text") RETURNS TABLE("success" boolean, "bank_name" "text", "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- [Mantenemos la lógica de validación del algoritmo aquí dentro]
    -- Al ser DEFINER puede hacer el UPSERT en seller_bank_accounts sin problemas de RLS
    -- [Omitido por brevedad pero inclúyelo en la ejecución real]
    RETURN QUERY SELECT true, 'BANCO'::TEXT, NULL::TEXT;
END; $$;


ALTER FUNCTION "internal"."fn_save_bank_account"("p_clabe" "text", "p_holder_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "internal"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN (SELECT (role = 'admin') FROM public.profiles WHERE id = auth.uid());
END; $$;


ALTER FUNCTION "internal"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_product_publication_economics"("p_product_id" "uuid") RETURNS TABLE("publication_shipping_reserve_cents" bigint, "publication_commission_rate" numeric, "publication_insurance_rate" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_shipping_buffer_cents BIGINT;
  v_commission_rate NUMERIC;
  v_insurance_rate NUMERIC;
  v_reserve_cents BIGINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  IF v_product.publication_shipping_reserve_cents IS NOT NULL
    OR v_product.publication_commission_rate IS NOT NULL
    OR v_product.publication_insurance_rate IS NOT NULL THEN
    IF v_product.publication_shipping_reserve_cents IS NULL
      OR v_product.publication_commission_rate IS NULL
      OR v_product.publication_insurance_rate IS NULL THEN
      RAISE EXCEPTION 'INVALID_PUBLICATION_ECONOMICS_SNAPSHOT';
    END IF;
    RETURN QUERY SELECT
      v_product.publication_shipping_reserve_cents,
      v_product.publication_commission_rate,
      v_product.publication_insurance_rate;
    RETURN;
  END IF;

  SELECT
    shipping_buffer_cents,
    normalize_publication_rate(service_fee_pct),
    normalize_publication_rate(insurance_rate)
  INTO v_shipping_buffer_cents, v_commission_rate, v_insurance_rate
  FROM public.system_settings
  WHERE id = 1;

  IF v_product.shipping_cost IS NULL
    OR v_shipping_buffer_cents IS NULL
    OR v_commission_rate IS NULL
    OR v_insurance_rate IS NULL THEN
    RAISE EXCEPTION 'LEGACY_PUBLICATION_ECONOMICS_UNAVAILABLE';
  END IF;

  v_reserve_cents :=
    round(v_product.shipping_cost * 100)::BIGINT
    + v_shipping_buffer_cents
    + ceil(round(v_product.price * 100)::NUMERIC * v_insurance_rate)::BIGINT;

  UPDATE public.products
  SET publication_shipping_reserve_cents = v_reserve_cents,
      publication_commission_rate = v_commission_rate,
      publication_insurance_rate = v_insurance_rate,
      updated_at = now()
  WHERE id = p_product_id;

  RETURN QUERY SELECT v_reserve_cents, v_commission_rate, v_insurance_rate;
END;
$$;


ALTER FUNCTION "public"."backfill_product_publication_economics"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_max_payment_methods"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Solo contamos las tarjetas activas (donde deleted_at es nulo)
  IF (SELECT COUNT(*) FROM public.payment_methods WHERE user_id = NEW.user_id AND deleted_at IS NULL) >= 3 THEN
    RAISE EXCEPTION 'PAYMENT_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_max_payment_methods"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_abort_payout_create_to_action_required"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_reason" "text", "p_claim_token" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET release_stage = 'action_required',
      release_stage_version = release_stage_version + 1,
      status = CASE WHEN status IN ('pending_reconciliation', 'reconciliation_needed') THEN 'reconciliation_needed' ELSE status END,
      action_required_reason = 'payout_create_outcome_unresolved',
      failure_reason = p_reason,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Token-conditional when the caller holds an executor claim; the manual
      -- release path passes NULL and is owned by the version-conditioned
      -- payout_create_in_progress fence stage.
      AND (
        p_claim_token IS NULL
        OR (
          payout_claim_token = p_claim_token
          AND payout_claim_expires_at > now()
        )
      )
      AND release_stage_version = p_expected_stage_version
      AND release_stage = 'payout_create_in_progress'
  RETURNING TRUE INTO v_updated;

  IF v_updated THEN
    -- An unresolved create outcome also moves the run's pending mappings into
    -- reconciliation so the active-release gate keeps the shipments parked.
    UPDATE public.connect_payout_run_shipments
    SET status = 'reconciliation_needed',
        updated_at = now()
      WHERE run_id = p_run_id
        AND status IN ('pending_reconciliation');
  END IF;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_abort_payout_create_to_action_required"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_reason" "text", "p_claim_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_abort_payout_create_to_action_required"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_reason" "text", "p_claim_token" "text") IS 'Aborts the payout create fence into action_required when the Stripe outcome cannot be reconciled to exactly one payout: no new payout is ever created from this state. Token- and version-conditional. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_acquire_connect_account_refresh"("p_stripe_account_id" "text", "p_source_event_id" "text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
  FROM public.connect_account_events cae
  WHERE cae.stripe_event_id = p_source_event_id
    AND cae.stripe_account_id = p_stripe_account_id;
  IF v_trigger_created IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;

  -- The PK upsert serializes even two first-ever acquisitions. Overflow raises
  -- rather than wrapping. No run lock and no network operation in acquisition.
  INSERT INTO public.connect_account_actionability (
    stripe_account_id, is_actionable, blocked_reason, stripe_created,
    source_event_id, refresh_generation, refresh_pending
  ) VALUES (
    p_stripe_account_id, FALSE, 'account_refresh_pending', v_trigger_created,
    p_source_event_id, 1, TRUE
  )
  ON CONFLICT (stripe_account_id) DO UPDATE
  SET refresh_generation = public.connect_account_actionability.refresh_generation + 1,
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
$_$;


ALTER FUNCTION "public"."fn_acquire_connect_account_refresh"("p_stripe_account_id" "text", "p_source_event_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_acquire_track_shipments_lease"("p_lane" "text") RETURNS TABLE("acquired" boolean, "lease_id" "uuid", "lease_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_lease_id UUID := pg_catalog.gen_random_uuid();
  v_lease_expires_at TIMESTAMPTZ := pg_catalog.statement_timestamp() + interval '300 seconds';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_lane NOT IN ('preparing', 'shipped') THEN
    RAISE EXCEPTION 'INVALID_TRACKING_LANE';
  END IF;

  IF p_lane = 'preparing' THEN
    UPDATE public.system_settings AS settings
    SET
      track_shipments_preparing_lease_id = v_lease_id,
      track_shipments_preparing_lease_expires_at = v_lease_expires_at
    WHERE id = 1
      AND (
        settings.track_shipments_preparing_lease_id IS NULL
        OR settings.track_shipments_preparing_lease_expires_at <= pg_catalog.statement_timestamp()
      )
    RETURNING
      settings.track_shipments_preparing_lease_id,
      settings.track_shipments_preparing_lease_expires_at
    INTO v_lease_id, v_lease_expires_at;
  ELSE
    UPDATE public.system_settings AS settings
    SET
      track_shipments_shipped_lease_id = v_lease_id,
      track_shipments_shipped_lease_expires_at = v_lease_expires_at
    WHERE id = 1
      AND (
        settings.track_shipments_shipped_lease_id IS NULL
        OR settings.track_shipments_shipped_lease_expires_at <= pg_catalog.statement_timestamp()
      )
    RETURNING
      settings.track_shipments_shipped_lease_id,
      settings.track_shipments_shipped_lease_expires_at
    INTO v_lease_id, v_lease_expires_at;
  END IF;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_lease_id, v_lease_expires_at;
  ELSE
    RETURN QUERY SELECT false, NULL::UUID, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;


ALTER FUNCTION "public"."fn_acquire_track_shipments_lease"("p_lane" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_admin_restore_product"("p_product_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_auth_user_id UUID;
  v_previous_status public.product_status_enum;
BEGIN
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  -- Read previous_status from the last soft-delete audit log
  SELECT (details->>'previous_status')::public.product_status_enum
  INTO v_previous_status
  FROM public.admin_audit_logs
  WHERE target_id = p_product_id::text
    AND action_type = 'PRODUCT_SOFT_DELETE'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Fallback to PENDING_VERIFICATION if no admin log found (seller self-deleted).
  -- Never auto-approve to VERIFIED — force re-moderation.
  IF v_previous_status IS NULL THEN
    v_previous_status := 'PENDING_VERIFICATION'::public.product_status_enum;
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
$$;


ALTER FUNCTION "public"."fn_admin_restore_product"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_admin_soft_delete_product"("p_product_id" "uuid", "p_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_auth_user_id UUID;
  v_previous_status public.product_status_enum;
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
      status = 'HIDDEN'::public.product_status_enum,
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
$$;


ALTER FUNCTION "public"."fn_admin_soft_delete_product"("p_product_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_admin_toggle_verified_seller"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_is_verified" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    -- 1. SEGURIDAD: Obtener ID desde JWT autenticado
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- 2. VALIDACIÓN DE ROL: Buscar en profiles_private vía is_admin()
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- 3. ACTUALIZAR SELLO EN PROFILES (is_verified_seller vive en profiles)
    UPDATE public.profiles
    SET is_verified_seller = p_is_verified,
        updated_at = now()
    WHERE id = p_target_user_id;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected = 0 THEN
        RETURN false;
    END IF;

    -- 4. AUDITORÍA: Registrar cambio en bitácora
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'USER_VERIFICATION_TOGGLE', p_target_user_id,
           jsonb_build_object('is_verified', p_is_verified, 'timestamp', now()));

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_admin_toggle_verified_seller',
            jsonb_build_object('target_id', p_target_user_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RETURN false;
END;
$$;


ALTER FUNCTION "public"."fn_admin_toggle_verified_seller"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_is_verified" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_admin_update_user_status"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_new_status" "public"."account_status", "p_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$

DECLARE
    v_auth_user_id UUID;
    v_previous_status public.account_status;
BEGIN
    -- A. SECURITY: actor comes from the authenticated JWT; the client-supplied admin id is ignored
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
            status = 'HIDDEN'::public.product_status_enum,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND deleted_at IS NULL
        AND status = ANY(ARRAY['VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW']::public.product_status_enum[]);

    -- Lifting a suspension restores only listings this hold hid; other HIDDEN listings stay hidden
    ELSIF p_new_status = 'active' AND v_previous_status = 'suspended' THEN
        UPDATE public.products
        SET status = status_before_account_hold,
            status_before_account_hold = NULL,
            updated_at = now()
        WHERE seller_id = p_target_user_id
        AND status = 'HIDDEN'::public.product_status_enum
        AND status_before_account_hold IS NOT NULL
        AND deleted_at IS NULL;

        -- Listings an admin moved out of HIDDEN during the suspension keep no stale hold
        UPDATE public.products
        SET status_before_account_hold = NULL
        WHERE seller_id = p_target_user_id
        AND status_before_account_hold IS NOT NULL
        AND status <> 'HIDDEN'::public.product_status_enum;
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
$$;


ALTER FUNCTION "public"."fn_admin_update_user_status"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_new_status" "public"."account_status", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_append_connect_payout_event"("p_stripe_event_id" "text", "p_event_type" "text", "p_stripe_payout_id" "text", "p_connect_payout_run_id" "uuid", "p_stripe_created" timestamp with time zone, "p_observed_payout_status" "text", "p_failure_code" "text" DEFAULT NULL::"text", "p_failure_message" "text" DEFAULT NULL::"text", "p_failure_balance_transaction" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  INSERT INTO public.connect_payout_events (
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
$$;


ALTER FUNCTION "public"."fn_append_connect_payout_event"("p_stripe_event_id" "text", "p_event_type" "text", "p_stripe_payout_id" "text", "p_connect_payout_run_id" "uuid", "p_stripe_created" timestamp with time zone, "p_observed_payout_status" "text", "p_failure_code" "text", "p_failure_message" "text", "p_failure_balance_transaction" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_apply_connect_account_actionability"("p_stripe_account_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean DEFAULT NULL::boolean, "p_external_account_status" "text" DEFAULT NULL::"text", "p_source_event_id" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'ACCOUNT_REFRESH_REQUIRED';
END;
$$;


ALTER FUNCTION "public"."fn_apply_connect_account_actionability"("p_stripe_account_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean, "p_external_account_status" "text", "p_source_event_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_apply_connect_account_actionability"("p_stripe_account_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean, "p_external_account_status" "text", "p_source_event_id" "text") IS 'Legacy event-time projection fenced with ACCOUNT_REFRESH_REQUIRED. Use separately committed acquire, authoritative paginated retrieval, and current-generation commit; never enable from signed historic bank state.';



CREATE OR REPLACE FUNCTION "public"."fn_atomic_payout_resume_mapping"("p_run_id" "uuid", "p_mode" "text", "p_expected_status" "text", "p_expected_stage" "text", "p_expected_version" integer, "p_shipment_ids" "uuid"[], "p_parent_run_id" "uuid", "p_expected_parent_version" integer, "p_expected_parent_payout_id" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_parent public.connect_payout_runs%ROWTYPE;
  v_count INTEGER;
  v_unique INTEGER;
  v_amount BIGINT;
  v_version INTEGER;
BEGIN
  -- NULL must refuse explicitly, never fall through SQL UNKNOWN comparisons.
  IF p_run_id IS NULL OR p_mode IS NULL OR p_mode NOT IN ('retry', 'pending')
    OR p_expected_status IS NULL OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_shipment_ids IS NULL OR cardinality(p_shipment_ids) < 1
    OR array_position(p_shipment_ids, NULL) IS NOT NULL
    OR cardinality(p_shipment_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_shipment_ids) x)
  THEN RETURN NULL; END IF;

  -- Lock the audit parent first, then its child, consistently with retry authority.
  IF p_parent_run_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.connect_payout_runs
      WHERE id = p_parent_run_id FOR UPDATE;
    IF NOT FOUND OR p_expected_parent_version IS NULL OR p_expected_parent_payout_id IS NULL
      OR v_parent.release_stage_version IS DISTINCT FROM p_expected_parent_version
      OR v_parent.stripe_payout_id IS DISTINCT FROM p_expected_parent_payout_id
      OR v_parent.status <> 'failed' OR v_parent.stripe_payout_id IS NULL
      OR v_parent.release_stage IS DISTINCT FROM 'payout_failed'
      OR v_parent.payout_claim_token IS NOT NULL OR v_parent.payout_claim_expires_at IS NOT NULL
    THEN RETURN NULL; END IF;
  ELSIF p_expected_parent_version IS NOT NULL OR p_expected_parent_payout_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_run.status IS DISTINCT FROM p_expected_status
    OR v_run.release_stage IS DISTINCT FROM p_expected_stage
    OR v_run.release_stage_version IS DISTINCT FROM p_expected_version
    OR v_run.retry_of_run_id IS DISTINCT FROM p_parent_run_id
    OR v_run.stripe_payout_id IS NOT NULL
    OR v_run.payout_claim_token IS NOT NULL OR v_run.payout_claim_expires_at IS NOT NULL
    OR v_run.payout_create_attempted_at IS NOT NULL OR v_run.paid_at IS NOT NULL
    OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id)
  THEN RETURN NULL; END IF;

  -- Only supported pre-payout states. A failed legacy run without a provider
  -- attempt may resume with the same key; provider-terminal failures cannot.
  IF v_run.status = 'pending_reconciliation' THEN
    IF v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted', 'awaiting_connected_balance')
      OR v_run.failed_at IS NOT NULL OR v_run.failure_reason IS NOT NULL
    THEN RETURN NULL; END IF;
  ELSIF p_mode = 'retry' AND v_run.status = 'failed' AND p_parent_run_id IS NULL THEN
    IF v_run.release_stage IS NOT NULL AND v_run.release_stage <> 'payout_failed'
    THEN RETURN NULL; END IF;
  ELSE RETURN NULL;
  END IF;

  -- Child identity and complete mapping set must agree with immutable failed
  -- parent history. No parent row or parent mapping is ever updated here.
  IF p_parent_run_id IS NOT NULL THEN
    IF v_parent.seller_id <> v_run.seller_id OR v_parent.amount <> v_run.amount
      OR v_run.id = v_parent.id
      OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_parent.id AND id <> v_run.id)
    THEN RETURN NULL; END IF;
    PERFORM 1 FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id ORDER BY shipment_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id AND status <> 'failed')
      OR EXISTS (
        (SELECT shipment_id, net_payout FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id
         EXCEPT SELECT shipment_id, net_payout FROM public.connect_payout_run_shipments WHERE run_id = v_run.id)
        UNION ALL
        (SELECT shipment_id, net_payout FROM public.connect_payout_run_shipments WHERE run_id = v_run.id
         EXCEPT SELECT shipment_id, net_payout FROM public.connect_payout_run_shipments WHERE run_id = v_parent.id)
      )
    THEN RETURN NULL; END IF;
  END IF;

  -- Lock every target mapping and its shipments. The existing active-once
  -- unique index also rejects concurrent foreign activation atomically.
  PERFORM 1 FROM public.connect_payout_run_shipments WHERE run_id = v_run.id ORDER BY shipment_id FOR UPDATE;
  PERFORM 1 FROM public.shipments WHERE id = ANY(p_shipment_ids) ORDER BY id FOR UPDATE;
  SELECT count(*), count(DISTINCT shipment_id), sum(net_payout)
    INTO v_count, v_unique, v_amount
    FROM public.connect_payout_run_shipments WHERE run_id = v_run.id;
  IF v_count <> cardinality(p_shipment_ids) OR v_unique <> v_count
    OR v_amount IS DISTINCT FROM v_run.amount::BIGINT
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments m
      JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = v_run.id AND (
        NOT (m.shipment_id = ANY(p_shipment_ids)) OR m.status <> v_run.status
        OR m.net_payout <= 0 OR s.seller_id <> v_run.seller_id
        OR s.status <> 'completed' OR s.completed_at IS NULL
        OR (p_mode = 'pending' AND s.stripe_transfer_id IS NULL)))
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
      WHERE shipment_id = ANY(p_shipment_ids) AND run_id <> v_run.id
        AND status IN ('pending_reconciliation', 'paid', 'reconciliation_needed'))
  THEN RETURN NULL; END IF;

  UPDATE public.connect_payout_runs
    SET status = 'pending_reconciliation', release_stage = 'awaiting_connected_balance',
        release_stage_version = release_stage_version + 1,
        failure_reason = NULL, failed_at = NULL, updated_at = now()
    WHERE id = v_run.id
    RETURNING release_stage_version INTO v_version;
  UPDATE public.connect_payout_run_shipments
    SET status = 'pending_reconciliation', updated_at = now()
    WHERE run_id = v_run.id;
  -- Exceptions (including active-once conflicts) roll back BOTH writes.
  RETURN v_version;
END;
$$;


ALTER FUNCTION "public"."fn_atomic_payout_resume_mapping"("p_run_id" "uuid", "p_mode" "text", "p_expected_status" "text", "p_expected_stage" "text", "p_expected_version" integer, "p_shipment_ids" "uuid"[], "p_parent_run_id" "uuid", "p_expected_parent_version" integer, "p_expected_parent_payout_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_begin_manual_payout_create_fence"("p_run_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
BEGIN
  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token
  INTO v_stage, v_version, v_token
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF v_token IS NOT NULL THEN
    -- Slice 3 residual race closure: the executor claim is inspected under
    -- the same row lock as the fence write, so a worker claim that lands
    -- concurrently conflicts atomically instead of racing the manual path
    -- between the inspect and the fence update. Any held token conflicts —
    -- a live lease means a worker is mid-flight, and a lapsed lease is
    -- reclaimed only by the worker claim flow, never by a manual bypass.
    RAISE EXCEPTION 'EXECUTOR_CLAIM_HELD';
  END IF;

  IF v_stage IS NOT NULL
    AND v_stage NOT IN (
      'release_accepted',
      'transfer_created',
      'awaiting_connected_balance'
    ) THEN
    -- Includes payout_create_in_progress (already fenced: reconcile, never
    -- recreate) and every terminal or action_required stage.
    RAISE EXCEPTION 'PAYOUT_CREATE_FENCE_CONFLICT';
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = 'payout_create_in_progress',
      release_stage_version = v_version + 1,
      payout_create_attempted_at = now(),
      updated_at = now()
    WHERE id = p_run_id;

  RETURN v_version + 1;
END;
$$;


ALTER FUNCTION "public"."fn_begin_manual_payout_create_fence"("p_run_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_begin_manual_payout_create_fence"("p_run_id" "uuid") IS 'Manual release path of the durable write-ahead fence: atomically transitions a pre-payout run (release_accepted, transfer_created, or awaiting_connected_balance) into payout_create_in_progress with payout_create_attempted_at and a bumped stage version, refuses an already-open fence so the admin endpoint can never create over an unreconciled Stripe attempt, and refuses any held executor claim (live or lapsed) under the same row lock — a lapsed claim is reclaimed only by the worker claim flow, never by a manual bypass. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_begin_payout_create_fence"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_version INTEGER;
  v_token TEXT;
  v_stage TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token,
         cpr.payout_claim_expires_at
  INTO v_stage, v_version, v_token, v_expires
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF p_claim_token IS NULL OR v_token IS NULL OR v_token <> p_claim_token THEN
    RAISE EXCEPTION 'STALE_CLAIM';
  END IF;

  -- A lapsed lease means the worker lost durable ownership: it must abort
  -- without opening the fence, and the Stripe create must never run.
  IF v_expires IS NULL OR v_expires <= now() THEN
    RAISE EXCEPTION 'CLAIM_LEASE_EXPIRED';
  END IF;

  IF p_expected_stage_version IS NULL OR v_version <> p_expected_stage_version THEN
    RAISE EXCEPTION 'STAGE_VERSION_CONFLICT';
  END IF;

  IF v_stage <> 'awaiting_connected_balance' THEN
    RAISE EXCEPTION 'PAYOUT_CREATE_FENCE_CONFLICT';
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = 'payout_create_in_progress',
      release_stage_version = v_version + 1,
      payout_create_attempted_at = now(),
      updated_at = now()
    WHERE id = p_run_id;

  RETURN v_version + 1;
END;
$$;


ALTER FUNCTION "public"."fn_begin_payout_create_fence"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_begin_payout_create_fence"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) IS 'Durable write-ahead fence before a Stripe payout create: claims the run into payout_create_in_progress with payout_create_attempted_at, token-, version-, and lease-conditional, so a crash after the Stripe call leaves a recoverable fence instead of a duplicate-create window. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_begin_shipment_transfer"("p_run_id" "uuid", "p_shipment_id" "uuid", "p_expected_stage_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_mapping public.connect_payout_run_shipments%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_row public.admin_connect_payout_release_view%ROWTYPE;
  v_token UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Match existing resume/terminal lock order: run, mapping, shipment. A
  -- cancellation owns only shipment/operation and reads transfer fences without
  -- locking mappings, so it cannot form a reverse-order lock cycle.
  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT'; END IF;
  IF p_expected_stage_version IS NULL
    OR v_run.release_stage_version IS DISTINCT FROM p_expected_stage_version
    OR v_run.status IS DISTINCT FROM 'pending_reconciliation'
    OR (v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted','awaiting_connected_balance'))
    OR v_run.stripe_payout_id IS NOT NULL
    OR v_run.payout_claim_token IS NOT NULL OR v_run.payout_claim_expires_at IS NOT NULL
    OR v_run.payout_create_attempted_at IS NOT NULL OR v_run.paid_at IS NOT NULL
    OR v_run.failed_at IS NOT NULL OR v_run.failure_reason IS NOT NULL
    OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT';
  END IF;
  SELECT * INTO v_mapping FROM public.connect_payout_run_shipments
    WHERE run_id = p_run_id AND shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT'; END IF;
  IF v_mapping.status IS DISTINCT FROM 'pending_reconciliation' THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OWNERSHIP_CONFLICT';
  END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  -- Read after the shared shipment lock, with the live clock after lock waits.
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id
      AND (external_started_at IS NOT NULL OR claim_expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_RECONCILIATION_REQUIRED';
  END IF;
  IF v_shipment.status IS DISTINCT FROM 'completed' OR v_shipment.completed_at IS NULL THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_COMPLETED';
  END IF;

  -- Reuse the canonical allocation/read model, not caller amounts or a second
  -- financial formula. Only this run's own active marker may be tolerated.
  SELECT * INTO v_row FROM public.admin_connect_payout_release_view WHERE shipment_id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_TRANSFER_INELIGIBLE'; END IF;
  IF v_shipment.seller_id IS DISTINCT FROM v_run.seller_id
    OR v_row.stripe_account_id IS NULL OR v_row.stripe_onboarding_status IS DISTINCT FROM 'complete'
    OR v_row.stripe_payment_intent_id IS NULL
    OR v_row.release_amount_cents IS NULL OR v_row.release_amount_cents <= 0
    OR v_mapping.net_payout IS DISTINCT FROM v_row.release_amount_cents
    OR v_run.amount::bigint IS DISTINCT FROM
      (SELECT sum(net_payout) FROM public.connect_payout_run_shipments WHERE run_id = p_run_id)
    OR (v_row.is_eligible IS DISTINCT FROM true AND v_row.ineligible_reason IS DISTINCT FROM 'already_released')
    OR EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
      WHERE shipment_id = p_shipment_id AND run_id <> p_run_id
        AND status IN ('pending_reconciliation','paid','reconciliation_needed')) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_INELIGIBLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn_get_connect_account_actionability(v_row.stripe_account_id)
    WHERE is_actionable = true) THEN
    RAISE EXCEPTION 'CONNECT_ACCOUNT_NOT_ACTIONABLE';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_shipment.order_id;
  IF NOT FOUND OR v_order.stripe_charge_id IS NULL OR btrim(v_order.stripe_charge_id) = ''
    OR v_order.stripe_transfer_group IS NULL OR btrim(v_order.stripe_transfer_group) = '' THEN
    RAISE EXCEPTION 'MISSING_SETTLEMENT_CONTEXT';
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.connect_payout_run_shipments
    SET transfer_started_at = clock_timestamp(), transfer_token = v_token
    WHERE id = v_mapping.id;
  -- No run stage/version mutation: preserve the existing resume intent epoch.
  RETURN jsonb_build_object('transfer_token', v_token,
    'amount', v_row.release_amount_cents, 'currency', 'mxn',
    'destination', v_row.stripe_account_id, 'source_transaction', v_order.stripe_charge_id,
    'transfer_group', v_order.stripe_transfer_group,
    'idempotency_key', v_run.idempotency_key || ':' || v_run.id::text || ':' || p_shipment_id::text,
    'metadata', jsonb_build_object('app_name','selene','run_id',v_run.id,
      'shipment_id',p_shipment_id,'seller_id',v_run.seller_id,'order_id',v_order.id));
END;
$$;


ALTER FUNCTION "public"."fn_begin_shipment_transfer"("p_run_id" "uuid", "p_shipment_id" "uuid", "p_expected_stage_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_block_payout_run_for_account_actionability"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_blocked_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET release_stage = 'action_required',
      release_stage_version = release_stage_version + 1,
      status = CASE
        WHEN status = 'pending_reconciliation' THEN 'reconciliation_needed'
        ELSE status
      END,
      action_required_reason = 'account_not_actionable',
      last_error = 'account_not_actionable: ' || COALESCE(p_blocked_reason, 'unknown'),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      AND payout_claim_token = p_claim_token
      AND release_stage_version = p_expected_stage_version
      AND payout_claim_expires_at IS NOT NULL
      AND payout_claim_expires_at > now()
      AND stripe_payout_id IS NULL
      AND release_stage IN (
        'awaiting_connected_balance',
        'payout_create_in_progress'
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_block_payout_run_for_account_actionability"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_blocked_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_blocked_reason" "text") IS 'Parks one claimed pre-payout run (awaiting_connected_balance or payout_create_in_progress) into action_required with the account_not_actionable reason, conditional on the exact claim token, expected stage version, and an unexpired lease, so a stale worker can never park a newer claim. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_buyer_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[]) RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
v_buyer_id UUID;
v_auth_user_id UUID;
v_status public.dispute_status;
BEGIN
v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    -- 2. Bloqueo y Validación
    SELECT buyer_id, status INTO v_buyer_id, v_status
    FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN; END IF;
    IF v_buyer_id != v_auth_user_id THEN RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN; END IF;
    IF v_status != 'waiting_return' THEN RETURN QUERY SELECT false, 'INVALID_STATUS_FOR_EVIDENCE'::TEXT; RETURN; END IF;

    -- 3. Validar input
    IF p_images IS NULL OR array_length(p_images, 1) < 1 THEN
        RETURN QUERY SELECT false, 'AT_LEAST_ONE_IMAGE_REQUIRED'::TEXT; RETURN;
    END IF;

    -- 4. Ejecutar
    UPDATE public.disputes
    SET buyer_evidence = buyer_evidence || jsonb_build_object('return_images', p_images),
        updated_at = now()
    WHERE id = p_dispute_id;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
INSERT INTO public.system_logs (level, message, metadata)
VALUES ('ERROR', 'Fallo en fn_buyer_submit_return_evidence', jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
RETURN QUERY SELECT false, SQLERRM;
END;
$$;


ALTER FUNCTION "public"."fn_buyer_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cancel_order"("p_order_id" "uuid", "p_reason" "text", "p_cancelled_by_role" "text") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$DECLARE
    v_status public.order_status_enum;
    v_buyer_id UUID;
    v_item RECORD;
    v_wallet_record RECORD;
BEGIN
    -- 1. Bloqueo y Validación de la Orden
    SELECT status, buyer_id INTO v_status, v_buyer_id 
    FROM public.orders 
    WHERE id = p_order_id 
    FOR UPDATE; -- Bloqueamos la fila para evitar cambios externos durante el proceso

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT;
        RETURN;
    END IF;

    IF v_status = 'cancelled' THEN
        RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT;
        RETURN;
    END IF;

    IF v_status != 'paid' THEN
        RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT;
        RETURN;
    END IF;

    -- 2. Loop de Reversión (Optimizado con JOIN)
    FOR v_item IN 
        SELECT 
            oi.product_id, 
            oi.seller_id, 
            oi.net_payout, 
            p.name as prod_name 
        FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        WHERE oi.order_id = p_order_id 
    LOOP
        
        -- A. Liberar Producto
        UPDATE public.products 
        SET status = 'VERIFIED', 
            reserved_at = NULL,
            updated_at = now() 
        WHERE id = v_item.product_id;

        -- B. Bloqueo de Wallet y Actualización de Balance
        -- Usamos FOR UPDATE para asegurar integridad financiera
        SELECT id, pending_balance INTO v_wallet_record 
        FROM public.wallets 
        WHERE user_id = v_item.seller_id 
        FOR UPDATE;

        IF v_wallet_record.id IS NOT NULL THEN
            UPDATE public.wallets 
            SET pending_balance = GREATEST(0, pending_balance - v_item.net_payout),
                updated_at = now()
            WHERE id = v_wallet_record.id;

            -- C. Ledger (Audit Trail)
            INSERT INTO public.wallet_transactions (
                wallet_id, 
                order_id, 
                amount, 
                net_amount, 
                balance_after, 
                type, 
                description
            ) VALUES (
                v_wallet_record.id, 
                p_order_id, 
                0, 
                -v_item.net_payout, 
                GREATEST(0, v_wallet_record.pending_balance - v_item.net_payout), 
                'adjustment', 
                'Cancelación (' || p_cancelled_by_role || '): ' || p_reason
            );
        END IF;

        -- D. Notificación al Vendedor
        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES (
            v_item.seller_id, 
            'warning', 
            'Venta Cancelada', 
            'Tu producto "' || v_item.prod_name || '" ha regresado a tu inventario por cancelación.',
            '/profile/listings'
        );
    END LOOP;

    -- 3. Finalizar Orden y Notificar al Comprador
    UPDATE public.orders 
    SET status = 'cancelled', 
        updated_at = now() 
    WHERE id = p_order_id;
    
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (
        v_buyer_id, 
        'info', 
        'Pedido Cancelado', 
        'Tu reembolso ha sido procesado. El dinero regresará a tu cuenta según los tiempos de tu banco.', 
        '/profile/orders'
    );

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico en logs del sistema
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('CRITICAL', 'Fallo en fn_cancel_order', jsonb_build_object('order_id', p_order_id, 'error', SQLERRM));
    
    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;$$;


ALTER FUNCTION "public"."fn_cancel_order"("p_order_id" "uuid", "p_reason" "text", "p_cancelled_by_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cancel_shipment"("p_shipment_id" "uuid", "p_cancelled_by_role" "text", "p_reason" "text", "p_cancellation_loss_cents" bigint DEFAULT NULL::bigint) RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status_enum;
  v_buyer_id UUID;
  v_wallet_id UUID;
  v_wallet_pending NUMERIC;
  v_wallet_available NUMERIC;
  v_total_refund NUMERIC;
  v_item RECORD;
  v_actual_stripe_fee_cents BIGINT;
  v_cancellation_loss_cents BIGINT;
  v_loss_update_cents BIGINT;
  v_next_cancellation_loss_cents BIGINT;
BEGIN
  -- 1. Lock shipment and validate eligibility.
  SELECT order_id, seller_id, status
    INTO v_order_id, v_seller_id, v_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT true, 'ALREADY_CANCELLED'::TEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('paid', 'preparing') THEN
    RETURN QUERY SELECT false, 'CANNOT_CANCEL_IN_THIS_STATUS'::TEXT;
    RETURN;
  END IF;

  -- 2. Service-role-only mutation; Edge Functions/crons validate the actor.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;
    RETURN;
  END IF;

  IF p_cancelled_by_role NOT IN ('buyer', 'seller', 'system') THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT;
    RETURN;
  END IF;

  -- 3. Lock order for refund-loss reconciliation.
  SELECT buyer_id, actual_stripe_fee_cents, cancellation_loss_cents
    INTO v_buyer_id, v_actual_stripe_fee_cents, v_cancellation_loss_cents
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- 4. Sum the shipment's seller refund basis.
  SELECT COALESCE(SUM(COALESCE(net_payout, 0)), 0)
    INTO v_total_refund
  FROM public.order_items
  WHERE shipment_id = p_shipment_id;

  -- 5. Revert the seller wallet once.
  SELECT id, pending_balance, available_balance
    INTO v_wallet_id, v_wallet_pending, v_wallet_available
  FROM public.wallets
  WHERE user_id = v_seller_id
  FOR UPDATE;

  IF v_wallet_id IS NOT NULL THEN
    UPDATE public.wallets
    SET pending_balance = GREATEST(0, pending_balance - v_total_refund),
        updated_at = now()
    WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id,
      order_id,
      shipment_id,
      amount,
      net_amount,
      balance_after,
      type,
      description
    )
    VALUES (
      v_wallet_id,
      v_order_id,
      p_shipment_id,
      0,
      -v_total_refund,
      v_wallet_available,
      'adjustment',
      'Cancelación (' || p_cancelled_by_role || '): ' || p_reason
    );
  END IF;

  -- 6. Release products before publishing the shipment transition.
  FOR v_item IN
    SELECT oi.product_id
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.shipment_id = p_shipment_id
  LOOP
    UPDATE public.products
    SET status = 'VERIFIED', reserved_at = NULL, updated_at = now()
    WHERE id = v_item.product_id;
  END LOOP;

  -- 7. Mark the shipment cancelled and persist any reconciled loss.
  UPDATE public.shipments
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_shipment_id;

  IF p_cancellation_loss_cents IS NOT NULL AND v_actual_stripe_fee_cents IS NOT NULL THEN
    v_loss_update_cents := p_cancellation_loss_cents;
    v_next_cancellation_loss_cents := LEAST(
      COALESCE(v_actual_stripe_fee_cents, 0),
      COALESCE(v_cancellation_loss_cents, 0) + v_loss_update_cents
    );

    UPDATE public.orders
    SET cancellation_loss_cents = v_next_cancellation_loss_cents,
        updated_at = now()
    WHERE id = v_order_id;
  END IF;

  -- One notice per distinct recipient for this committed shipment transition.
  INSERT INTO public.notifications (
    user_id, event_kind, source_event_key, event_payload,
    type, title, message, action_path
  )
  SELECT recipients.user_id,
         'shipment.cancelled',
         'shipment.cancelled:' || p_shipment_id::text,
         jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id,
                            'recipient_role', recipients.recipient_role),
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'info' ELSE 'warning' END,
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'Pedido cancelado'
              ELSE 'Venta cancelada' END,
         CASE WHEN recipients.recipient_role = 'buyer' THEN 'Se canceló un envío de tu pedido.'
              ELSE 'Se canceló tu envío; los productos regresaron a tu inventario.' END,
         '/profile/orders/' || v_order_id::text
  -- WHERE true disambiguates INSERT ... SELECT from JOIN ON before ON CONFLICT.
  FROM (
    SELECT v_buyer_id AS user_id, 'buyer' AS recipient_role
    UNION ALL
    SELECT v_seller_id, 'seller' WHERE v_seller_id IS DISTINCT FROM v_buyer_id
  ) recipients
  WHERE true
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'CRITICAL',
    'Fallo en fn_cancel_shipment',
    jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM)
  );
  RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;


ALTER FUNCTION "public"."fn_cancel_shipment"("p_shipment_id" "uuid", "p_cancelled_by_role" "text", "p_reason" "text", "p_cancellation_loss_cents" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_claim_awaiting_balance_payout_run"("p_lease_seconds" integer DEFAULT 300) RETURNS TABLE("run_id" "uuid", "actor_id" "uuid", "seller_id" "uuid", "amount_cents" integer, "idempotency_key" "text", "shipment_ids" "uuid"[], "claim_token" "text", "stage_version" integer, "claim_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  LEFT JOIN public.connect_account_actionability caa
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
$$;


ALTER FUNCTION "public"."fn_claim_awaiting_balance_payout_run"("p_lease_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"("p_lease_seconds" integer) IS 'Claims one awaiting-balance payout run (pending_reconciliation, no Stripe payout id, awaiting_connected_balance or legacy stage, actionable account, next attempt due, unclaimed or expired lease, every shipment already transferred) under a short FOR UPDATE SKIP LOCKED lease and returns the DB-derived run fields plus the fresh claim token and the stage version the claim just bumped, which fence every worker write. Every claim mints a new fencing epoch by bumping the version. All due candidates (due deferred and immediate) are fairly ordered by readiness time so deferred runs cannot starve under sustained arrivals. Server-only; execution is restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_claim_checkout_recovery_shells"("p_limit" integer DEFAULT 25, "p_stripe_payment_intent_id" "text" DEFAULT NULL::"text", "p_claim_scope" "text" DEFAULT NULL::"text") RETURNS TABLE("stripe_payment_intent_id" "text", "stripe_charge_id" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- NULL preserves named-PaymentIntent order-first fallback behavior.
  IF p_claim_scope IS NOT NULL AND p_claim_scope NOT IN ('order', 'standalone') THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_RECOVERY_CLAIM_SCOPE';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.payment_processing = true
      AND o.stripe_payment_intent_id IS NOT NULL
      AND (p_claim_scope IS NULL OR p_claim_scope = 'order')
      AND (p_stripe_payment_intent_id IS NULL OR o.stripe_payment_intent_id = p_stripe_payment_intent_id)
      AND o.compensation_state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding')
      AND (
        (
          o.compensation_state = 'refund_pending'
          AND (
            p_stripe_payment_intent_id IS NOT NULL
            OR o.next_compensation_retry_at <= now()
            OR (
              o.next_compensation_retry_at IS NULL
              AND o.created_at <= now() - interval '5 minutes'
            )
          )
        )
        OR (
          o.compensation_state = 'refund_failed_retry_queued'
          AND (o.next_compensation_retry_at IS NULL OR o.next_compensation_retry_at <= now())
        )
        OR (
          o.compensation_state = 'refunding'
          AND o.compensation_lease_expires_at <= now()
        )
      )
    ORDER BY o.created_at, o.id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  )
  UPDATE public.orders o
  SET compensation_state = 'refunding',
      compensation_attempt_count = o.compensation_attempt_count + 1,
      compensation_lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  FROM eligible
  WHERE o.id = eligible.id
  RETURNING o.stripe_payment_intent_id, o.stripe_charge_id;

  IF FOUND OR p_claim_scope = 'order' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT s.stripe_payment_intent_id
    FROM public.checkout_recovery_shells s
    WHERE (p_claim_scope IS NULL OR p_claim_scope = 'standalone')
      AND (p_stripe_payment_intent_id IS NULL OR s.stripe_payment_intent_id = p_stripe_payment_intent_id)
      AND s.compensation_state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding')
      AND (
        (
          s.compensation_state = 'refund_pending'
          AND (
            p_stripe_payment_intent_id IS NOT NULL
            OR s.next_compensation_retry_at <= now()
            OR (s.next_compensation_retry_at IS NULL AND s.created_at <= now() - interval '5 minutes')
          )
        )
        OR (
          s.compensation_state = 'refund_failed_retry_queued'
          AND (s.next_compensation_retry_at IS NULL OR s.next_compensation_retry_at <= now())
        )
        OR (
          s.compensation_state = 'refunding'
          AND s.compensation_lease_expires_at <= now()
        )
      )
    ORDER BY s.created_at, s.stripe_payment_intent_id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  )
  UPDATE public.checkout_recovery_shells s
  SET compensation_state = 'refunding',
      compensation_attempt_count = s.compensation_attempt_count + 1,
      compensation_lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  FROM eligible
  WHERE s.stripe_payment_intent_id = eligible.stripe_payment_intent_id
  RETURNING s.stripe_payment_intent_id, s.stripe_charge_id;
END;
$$;


ALTER FUNCTION "public"."fn_claim_checkout_recovery_shells"("p_limit" integer, "p_stripe_payment_intent_id" "text", "p_claim_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_claim_payout_create_reconciliation"("p_grace_seconds" integer DEFAULT 600) RETURNS TABLE("run_id" "uuid", "actor_id" "uuid", "seller_id" "uuid", "amount_cents" integer, "idempotency_key" "text", "stripe_account_id" "text", "payout_create_attempted_at" timestamp with time zone, "claim_token" "text", "stage_version" integer, "claim_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_grace_seconds INTEGER;
  v_lease TIMESTAMPTZ;
  v_run_id UUID;
  v_claim_token TEXT;
BEGIN
  IF p_grace_seconds IS NULL OR p_grace_seconds < 30 OR p_grace_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_GRACE_SECONDS';
  END IF;

  v_grace_seconds := p_grace_seconds;
  v_lease := now() + make_interval(secs => 300);

  SELECT cpr.id
  INTO v_run_id
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  WHERE cpr.release_stage = 'payout_create_in_progress'
    AND cpr.payout_create_attempted_at <= now() - make_interval(secs => v_grace_seconds)
    AND (
      cpr.payout_claim_expires_at IS NULL
      OR cpr.payout_claim_expires_at <= now()
    )
  ORDER BY cpr.payout_create_attempted_at
  FOR UPDATE OF cpr SKIP LOCKED
  LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN;
  END IF;

  v_claim_token := gen_random_uuid()::text;

  UPDATE public.connect_payout_runs
  SET payout_claim_token = v_claim_token,
      payout_claim_expires_at = v_lease,
      -- The reconciliation claim also mints a new fencing epoch: the lapsed
      -- worker's token+version pair stops being valid the moment the fence
      -- is claimed for listing-based reconciliation.
      release_stage_version = release_stage_version + 1,
      updated_at = now()
  WHERE id = v_run_id;

  RETURN QUERY SELECT
    cpr.id,
    cpr.actor_id,
    cpr.seller_id,
    cpr.amount,
    cpr.idempotency_key,
    pp.stripe_account_id,
    cpr.payout_create_attempted_at,
    v_claim_token,
    cpr.release_stage_version,
    v_lease
  FROM public.connect_payout_runs cpr
  LEFT JOIN public.profiles_private pp ON pp.id = cpr.seller_id
  WHERE cpr.id = v_run_id;
END;
$$;


ALTER FUNCTION "public"."fn_claim_payout_create_reconciliation"("p_grace_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_claim_payout_create_reconciliation"("p_grace_seconds" integer) IS 'Claims one stale payout_create_in_progress run (Stripe create attempt older than the bounded grace window, unclaimed or expired lease) so the worker reconciles the Stripe outcome by server-side listing in the connected-account context; it must never create a second payout. The claim mints a fresh token and bumps the stage version, so a lapsed holder can no longer complete or abort the fence. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_claim_shipment_cancellation"("p_shipment_id" "uuid", "p_order_id" "uuid", "p_actor_id" "uuid", "p_source" "text", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_buyer_id UUID;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('buyer', 'seller', 'paid_timeout', 'preparing_timeout')
     OR p_reason IS NULL OR btrim(p_reason) = ''
     OR (p_source IN ('buyer', 'seller') AND p_actor_id IS NULL)
     OR (p_source IN ('paid_timeout', 'preparing_timeout') AND p_actor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_CONTEXT';
  END IF;

  -- Every future participating writer must lock this same shipment first.
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  IF v_shipment.order_id IS DISTINCT FROM p_order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  SELECT buyer_id INTO v_buyer_id FROM public.orders WHERE id = v_shipment.order_id;
  IF p_source = 'buyer' AND p_actor_id IS DISTINCT FROM v_buyer_id THEN RAISE EXCEPTION 'ORDER_BUYER_MISMATCH'; END IF;
  IF p_source = 'seller' AND p_actor_id IS DISTINCT FROM v_shipment.seller_id THEN RAISE EXCEPTION 'SHIPMENT_SELLER_MISMATCH'; END IF;

  IF (p_source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (p_source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  -- Do not weaken the label system's orphan fence. A generated preparing label
  -- is not an in-flight generation; carrier cancellation policy remains B4.
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF FOUND THEN
    -- Later callers cannot change the winning source, actor, reason or key.
    v_result := jsonb_build_object('operation_key', v_operation.operation_key,
      'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason);
    IF v_operation.external_started_at IS NOT NULL THEN
      RETURN v_result || jsonb_build_object('status', 'recovery_required');
    END IF;
    IF v_operation.claim_expires_at > clock_timestamp() THEN
      RETURN v_result || jsonb_build_object('status', 'busy');
    END IF;
    -- A stale pre-call worker can no longer pass start after token rotation.
    UPDATE public.shipment_cancellation_operations
      SET claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '15 minutes'
      WHERE shipment_id = p_shipment_id
      RETURNING * INTO v_operation;
  ELSE
    INSERT INTO public.shipment_cancellation_operations
      (shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at)
      VALUES (p_shipment_id, p_order_id, p_source, p_actor_id, p_reason,
        gen_random_uuid(), clock_timestamp() + interval '15 minutes')
      RETURNING * INTO v_operation;
  END IF;

  RETURN jsonb_build_object('status', 'claimed', 'operation_key', v_operation.operation_key,
    'source', v_operation.source, 'actor_id', v_operation.actor_id, 'reason', v_operation.reason,
    'claim_token', v_operation.claim_token, 'claim_expires_at', v_operation.claim_expires_at);
END;
$$;


ALTER FUNCTION "public"."fn_claim_shipment_cancellation"("p_shipment_id" "uuid", "p_order_id" "uuid", "p_actor_id" "uuid", "p_source" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_claim_shipment_label"("p_shipment_id" "uuid", "p_seller_id" "uuid", "p_origin_address_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_seller_id UUID; v_state TEXT; v_token UUID; v_origin JSONB; v_claim_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT seller_id, label_generation_state, origin_address, claim_expires_at
    INTO v_seller_id, v_state, v_origin, v_claim_expires_at
    FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_seller_id IS DISTINCT FROM p_seller_id THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Cancellation writers hold this same shipment lock before touching their row.
  -- Keep expired pre-start context: its owner cannot start while a label owns it.
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id
      AND (external_started_at IS NOT NULL OR claim_expires_at > clock_timestamp())) THEN
    RAISE EXCEPTION 'SHIPMENT_CANCELLATION_OPERATION_ACTIVE';
  END IF;
  IF v_state = 'generated' THEN RETURN jsonb_build_object('status', 'generated'); END IF;
  IF v_state = 'orphan_pending' THEN RETURN jsonb_build_object('status', 'orphan_pending'); END IF;
  IF v_state IN ('claimed', 'generation_sent') AND v_claim_expires_at <= clock_timestamp() THEN
    UPDATE public.shipments SET label_generation_state = 'orphan_pending', claim_expires_at = NULL,
      updated_at = now() WHERE id = p_shipment_id;
    INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id, metadata)
      VALUES (p_shipment_id, 'orphaned', p_seller_id,
        jsonb_build_object('errorClass', 'stale_claim_requires_reconciliation'));
    RETURN jsonb_build_object('status', 'orphan_pending', 'reconciliation_required', true);
  END IF;
  IF v_state IN ('claimed', 'generation_sent') THEN RETURN jsonb_build_object('status', 'claimed_conflict'); END IF;
  IF v_origin IS NULL THEN
    SELECT jsonb_build_object('full_name', a.full_name, 'phone', a.phone,
      'street_line1', a.street_line1, 'street_number', a.street_number,
      'district', a.district, 'city', a.city, 'state', a.state,
      'country', a.country, 'zip_code', a.zip_code)
    INTO v_origin FROM public.addresses a
    WHERE a.id = p_origin_address_id AND a.user_id = v_seller_id AND a.deleted_at IS NULL;
    IF v_origin IS NULL OR COALESCE(btrim(v_origin ->> 'street_number'), '') = '' THEN
      RAISE EXCEPTION 'SELLER_ORIGIN_CORRECTION_REQUIRED';
    END IF;
    UPDATE public.shipments SET origin_address_id = p_origin_address_id, origin_address = v_origin
      WHERE id = p_shipment_id AND origin_address IS NULL;
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.shipments SET label_generation_state = 'claimed', claim_token = v_token,
    claim_expires_at = clock_timestamp() + interval '15 minutes', updated_at = now()
    WHERE id = p_shipment_id AND status = 'paid'
      AND label_generation_state IN ('unclaimed', 'retryable_rejected');
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'ineligible'); END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id)
    VALUES (p_shipment_id, 'claimed', p_seller_id);
  RETURN jsonb_build_object('status', 'claimed', 'claim_token', v_token, 'origin_address', v_origin);
END;
$$;


ALTER FUNCTION "public"."fn_claim_shipment_label"("p_shipment_id" "uuid", "p_seller_id" "uuid", "p_origin_address_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."stripe_fee_reconciliation_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "stripe_payment_intent_id" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "next_retry_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claim_token" "uuid",
    "claim_expires_at" timestamp with time zone,
    CONSTRAINT "stripe_fee_reconciliation_jobs_attempt_count_check" CHECK ((("attempt_count" >= 0) AND ("attempt_count" <= 100))),
    CONSTRAINT "stripe_fee_reconciliation_jobs_last_error_check" CHECK ((("last_error" IS NULL) OR ("char_length"("last_error") <= 4000))),
    CONSTRAINT "stripe_fee_reconciliation_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'succeeded'::"text", 'failed'::"text"]))),
    CONSTRAINT "stripe_fee_reconciliation_jobs_stripe_payment_intent_id_check" CHECK ((("char_length"("stripe_payment_intent_id") >= 1) AND ("char_length"("stripe_payment_intent_id") <= 255)))
);


ALTER TABLE "public"."stripe_fee_reconciliation_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."stripe_fee_reconciliation_jobs" IS 'Server-only recovery ledger for reconciling actual Stripe processing fees against paid orders.';



COMMENT ON COLUMN "public"."stripe_fee_reconciliation_jobs"."attempt_count" IS 'Bounded count of reconciliation attempts, including the active processing attempt.';



COMMENT ON COLUMN "public"."stripe_fee_reconciliation_jobs"."next_retry_at" IS 'Earliest time a pending or failed reconciliation job is eligible for its next attempt.';



COMMENT ON COLUMN "public"."stripe_fee_reconciliation_jobs"."claim_token" IS 'Opaque active ownership; retained on success solely for same-token completion replay.';



COMMENT ON COLUMN "public"."stripe_fee_reconciliation_jobs"."claim_expires_at" IS 'Database-clock active lease expiry; NULL after success, retry, or failure.';



CREATE OR REPLACE FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"("p_limit" integer DEFAULT 25) RETURNS SETOF "public"."stripe_fee_reconciliation_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'STRIPE_FEE_LEASE_REQUIRED' USING ERRCODE = 'P0001';
END;
$$;


ALTER FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"("p_limit" integer DEFAULT 25, "p_max_attempts" integer DEFAULT 3) RETURNS SETOF "public"."stripe_fee_reconciliation_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_job public.stripe_fee_reconciliation_jobs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 100 THEN
    RAISE EXCEPTION 'INVALID_CLAIM_POLICY' USING ERRCODE = '22023';
  END IF;

  -- Every examined row, including exhausted rows, belongs to this bounded batch.
  FOR v_job IN
    SELECT job.*
    FROM public.stripe_fee_reconciliation_jobs AS job
    WHERE (job.status = 'pending'
           AND (job.next_retry_at IS NULL OR job.next_retry_at <= clock_timestamp()))
       OR (job.status = 'processing'
           AND (job.claim_expires_at <= clock_timestamp()
                OR (job.claim_token IS NULL AND job.claim_expires_at IS NULL
                    AND job.updated_at <= clock_timestamp() - INTERVAL '5 minutes')))
    ORDER BY job.next_retry_at NULLS FIRST, job.created_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  LOOP
    IF v_job.attempt_count >= p_max_attempts THEN
      UPDATE public.stripe_fee_reconciliation_jobs
      SET status = 'failed', claim_token = NULL, claim_expires_at = NULL,
          next_retry_at = NULL, last_error = 'STRIPE_FEE_ATTEMPTS_EXHAUSTED',
          updated_at = clock_timestamp()
      WHERE id = v_job.id;
    ELSE
      UPDATE public.stripe_fee_reconciliation_jobs
      SET status = 'processing', attempt_count = attempt_count + 1,
          claim_token = gen_random_uuid(),
          claim_expires_at = clock_timestamp() + INTERVAL '5 minutes',
          next_retry_at = NULL, updated_at = clock_timestamp()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
      RETURN NEXT v_job;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"("p_limit" integer, "p_max_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_commit_connect_account_refresh"("p_stripe_account_id" "text", "p_expected_generation" bigint, "p_source_event_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_payouts_enabled" boolean, "p_current_external_account_id" "text", "p_current_external_account_status" "text", "p_current_currency" "text", "p_current_default_for_currency" boolean, "p_mxn_default_count" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
    SELECT 1 FROM public.connect_account_events cae
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
  UPDATE public.connect_account_actionability caa
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
$_$;


ALTER FUNCTION "public"."fn_commit_connect_account_refresh"("p_stripe_account_id" "text", "p_expected_generation" bigint, "p_source_event_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_payouts_enabled" boolean, "p_current_external_account_id" "text", "p_current_external_account_status" "text", "p_current_currency" "text", "p_current_default_for_currency" boolean, "p_mxn_default_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_complete_payout_create_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_stripe_payout_id" "text", "p_claim_token" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  IF p_stripe_payout_id IS NULL OR btrim(p_stripe_payout_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_PAYOUT_ID';
  END IF;

  UPDATE public.connect_payout_runs
  SET stripe_payout_id = COALESCE(stripe_payout_id, p_stripe_payout_id),
      release_stage = CASE
        WHEN release_stage IN (
          'payout_pending',
          'payout_in_transit',
          'paid_observed',
          'payout_failed',
          'payout_canceled'
        ) THEN release_stage
        ELSE 'payout_pending'
      END,
      release_stage_version = release_stage_version + 1,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Version-conditional: a webhook that already projected a later stage
      -- or a terminal outcome has bumped the version, so a stale completion
      -- is rejected instead of regressing the aggregate.
      AND release_stage_version = p_expected_stage_version
      -- Token-conditional when the caller holds an executor claim; the
      -- manual release path passes NULL and owns the run through the
      -- version-conditioned payout_create_in_progress fence stage alone.
      -- The executor-owned exit also requires an unexpired lease: a worker
      -- whose lease lapsed mid-flight must not mutate the fenced run.
      AND (
        p_claim_token IS NULL
        OR (
          payout_claim_token = p_claim_token
          AND payout_claim_expires_at > now()
        )
      )
      AND release_stage IN (
        'payout_create_in_progress',
        'payout_pending',
        'payout_in_transit',
        'paid_observed',
        'payout_failed',
        'payout_canceled'
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_complete_payout_create_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_stripe_payout_id" "text", "p_claim_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_complete_payout_create_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_stripe_payout_id" "text", "p_claim_token" "text") IS 'Exits the payout create fence with the authoritative Stripe payout id: attaches it when absent, advances payout_create_in_progress to payout_pending, and never regresses a later webhook stage or terminal projection. Returns FALSE when a webhook already consumed the claim or version, so the worker must not write pending state. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_complete_shipment_refund"("p_shipment_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_buyer_id UUID;
  v_shipment_status TEXT;
  v_stripe_payment_intent_id TEXT;
  v_net_payout NUMERIC;
  v_wallet_id UUID;
  v_wallet_available NUMERIC;
  v_dispute_id UUID;
BEGIN
  -- 1. Validar shipment y obtener datos (Usa public.shipments y public.orders)
  SELECT s.order_id, s.seller_id, s.status::TEXT, s.stripe_payment_intent_id, o.buyer_id
  INTO v_order_id, v_seller_id, v_shipment_status, v_stripe_payment_intent_id, v_buyer_id
  FROM public.shipments s
  JOIN public.orders o ON o.id = s.order_id
  WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- Connect guard: Connect refunds are handled by Stripe reverse_transfer in
  -- resolve-dispute-refund. This legacy wallet rollback function must not write
  -- wallets or wallet_transactions for Connect-era shipments.
  IF v_stripe_payment_intent_id IS NOT NULL THEN
    UPDATE public.shipments
    SET status = 'refunded', updated_at = now()
    WHERE id = p_shipment_id;
    RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET_REFUND'::TEXT; RETURN;
  END IF;

  -- 1b. No reembolsar shipments ya refunded o completed (fondos ya liberados)
  IF v_shipment_status IN ('refunded', 'completed', 'cancelled', 'pending') THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_REFUNDABLE'::TEXT; RETURN;
  END IF;

  -- 2. Obtener dispute asociado
  SELECT id INTO v_dispute_id FROM public.disputes
  WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  LIMIT 1;

  -- 3. Calcular net_payout de este shipment (COALESCE por defensa ante NULL)
  SELECT COALESCE(SUM(net_payout), 0) INTO v_net_payout
  FROM public.order_items WHERE shipment_id = p_shipment_id;

  -- 4. Revertir pending_balance del seller
  UPDATE public.wallets
  SET pending_balance = GREATEST(0, pending_balance - v_net_payout),
      updated_at = now()
  WHERE user_id = v_seller_id
  RETURNING id, available_balance INTO v_wallet_id, v_wallet_available;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'WALLET_UPDATE_FAILED'::TEXT; RETURN;
  END IF;

  -- 5. Ledger
  INSERT INTO public.wallet_transactions (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
  VALUES (v_wallet_id, v_order_id, p_shipment_id, -v_net_payout, -v_net_payout, v_wallet_available, 'refund', 'Reembolso por disputa resuelta — Shipment ' || p_shipment_id);

  -- 6. Liberar productos de este shipment
  UPDATE public.products SET status = 'IN_REVIEW', updated_at = now()
  WHERE id IN (SELECT product_id FROM public.order_items WHERE shipment_id = p_shipment_id);

  -- 7. Marcar shipment como refunded (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'refunded', updated_at = now()
  WHERE id = p_shipment_id;

  -- 8. Resolver la disputa si existe
  IF v_dispute_id IS NOT NULL THEN
    UPDATE public.disputes
    SET status = 'resolved', resolution_type = 'buyer', updated_at = now()
    WHERE id = v_dispute_id;
  END IF;

  -- 9. Notificaciones
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES
    (v_buyer_id, 'success', 'Reembolso Finalizado', 'Tu dinero ha sido devuelto.', '/profile/orders/' || v_order_id),
    (v_seller_id, 'warning', 'Producto Reembolsado', 'El producto está en revisión técnica.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_complete_shipment_refund',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;


ALTER FUNCTION "public"."fn_complete_shipment_refund"("p_shipment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_complete_shipment_transfer"("p_run_id" "uuid", "p_shipment_id" "uuid", "p_expected_stage_version" integer, "p_transfer_token" "uuid", "p_stripe_transfer_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_run public.connect_payout_runs%ROWTYPE;
  v_mapping public.connect_payout_run_shipments%ROWTYPE;
  v_shipment public.shipments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_stripe_transfer_id IS NULL OR btrim(p_stripe_transfer_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_TRANSFER_ID';
  END IF;
  SELECT * INTO v_run FROM public.connect_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_expected_stage_version IS NULL OR v_run.release_stage_version IS DISTINCT FROM p_expected_stage_version
    OR v_run.status IS DISTINCT FROM 'pending_reconciliation'
    OR (v_run.release_stage IS NOT NULL AND v_run.release_stage NOT IN ('release_accepted','awaiting_connected_balance'))
    OR v_run.stripe_payout_id IS NOT NULL OR v_run.payout_claim_token IS NOT NULL
    OR v_run.payout_claim_expires_at IS NOT NULL OR v_run.payout_create_attempted_at IS NOT NULL
    OR v_run.paid_at IS NOT NULL OR v_run.failed_at IS NOT NULL
    OR v_run.failure_reason IS NOT NULL OR v_run.action_required_reason IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.connect_payout_runs WHERE retry_of_run_id = v_run.id) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_mapping FROM public.connect_payout_run_shipments
    WHERE run_id = p_run_id AND shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_transfer_token IS NULL OR v_mapping.transfer_token IS DISTINCT FROM p_transfer_token
    OR v_mapping.transfer_started_at IS NULL OR v_mapping.status IS DISTINCT FROM 'pending_reconciliation' THEN
    RETURN false;
  END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_shipment.seller_id IS DISTINCT FROM v_run.seller_id THEN RETURN false; END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL THEN
    RETURN v_shipment.stripe_transfer_id = p_stripe_transfer_id;
  END IF;
  UPDATE public.shipments SET stripe_transfer_id = p_stripe_transfer_id WHERE id = p_shipment_id;
  -- Never clear the possible-effect fence, including on idempotent completion.
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."fn_complete_shipment_transfer"("p_run_id" "uuid", "p_shipment_id" "uuid", "p_expected_stage_version" integer, "p_transfer_token" "uuid", "p_stripe_transfer_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"("p_job_id" "uuid", "p_actual_stripe_fee_cents" bigint, "p_reconciled_at" timestamp with time zone) RETURNS "public"."stripe_fee_reconciliation_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'STRIPE_FEE_LEASE_REQUIRED' USING ERRCODE = 'P0001';
END;
$$;


ALTER FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"("p_job_id" "uuid", "p_actual_stripe_fee_cents" bigint, "p_reconciled_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job_leased"("p_job_id" "uuid", "p_claim_token" "uuid", "p_actual_stripe_fee_cents" bigint, "p_reconciled_at" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_job public.stripe_fee_reconciliation_jobs;
  v_payment_intent_id TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR p_job_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_actual_stripe_fee_cents IS NULL OR p_actual_stripe_fee_cents < 0
     OR p_reconciled_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_COMPLETION' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.stripe_fee_reconciliation_jobs
  WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN FALSE;
  END IF;
  -- Successful ownership evidence is retained; a duplicate performs no writes.
  IF v_job.status = 'succeeded' THEN
    RETURN TRUE;
  END IF;
  IF v_job.status <> 'processing' THEN
    RETURN FALSE;
  END IF;

  SELECT stripe_payment_intent_id INTO v_payment_intent_id
  FROM public.orders WHERE id = v_job.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_payment_intent_id IS DISTINCT FROM v_job.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_INTENT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  -- Recheck after BOTH locks: waiting for the order must not extend an expired lease.
  IF v_job.claim_expires_at IS NULL
     OR v_job.claim_expires_at <= clock_timestamp() THEN
    RETURN FALSE;
  END IF;

  UPDATE public.orders
  SET actual_stripe_fee_cents = p_actual_stripe_fee_cents,
      stripe_fee_reconciled_at = p_reconciled_at, updated_at = clock_timestamp()
  WHERE id = v_job.order_id AND actual_stripe_fee_cents IS NULL;

  UPDATE public.stripe_fee_reconciliation_jobs
  SET status = 'succeeded', next_retry_at = NULL, last_error = NULL,
      claim_expires_at = NULL, updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job_leased"("p_job_id" "uuid", "p_claim_token" "uuid", "p_actual_stripe_fee_cents" bigint, "p_reconciled_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_confirm_shipment_delivery"("p_shipment_id" "uuid", "p_source" "text", "p_actor_id" "uuid", "p_idempotency_key" "text") RETURNS TABLE("success" boolean, "error" "text", "completion_source" "text", "idempotent" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_order_id uuid;
  v_seller_id uuid;
  v_buyer_id uuid;
  v_status public.order_status_enum;
  v_delivered_at timestamptz;
  v_buyer_confirmed_at timestamptz;
  v_is_connect BOOLEAN;
  v_wallet_id uuid;
  v_wallet_balance numeric;
  v_net_payout numeric;
  v_completion_source text;
  v_completed_at timestamptz := now();
BEGIN
  IF coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    ''
  ) <> 'service_role' THEN
    RETURN QUERY SELECT false, 'SERVICE_ROLE_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('buyer', 'auto') THEN
    RETURN QUERY SELECT false, 'INVALID_COMPLETION_SOURCE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RETURN QUERY SELECT false, 'IDEMPOTENCY_KEY_REQUIRED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer'
    AND p_idempotency_key <> 'confirm_shipment_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'auto'
    AND p_idempotency_key <> 'auto_completion_' || p_shipment_id::text THEN
    RETURN QUERY SELECT false, 'INVALID_IDEMPOTENCY_KEY'::text, NULL::text, false;
    RETURN;
  END IF;

  SELECT
    s.order_id,
    s.seller_id,
    s.status,
    s.delivered_at,
    s.buyer_confirmed_at,
    s.stripe_payment_intent_id IS NOT NULL
  INTO
    v_order_id,
    v_seller_id,
    v_status,
    v_delivered_at,
    v_buyer_confirmed_at,
    v_is_connect
  FROM public.shipments AS s
  WHERE s.id = p_shipment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::text, NULL::text, false;
    RETURN;
  END IF;

  IF v_status = 'completed' THEN
    SELECT event.source
    INTO v_completion_source
    FROM public.shipment_completion_events AS event
    WHERE event.shipment_id = p_shipment_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'COMPLETION_AUDIT_MISSING'::text, NULL::text, false;
      RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL::text, v_completion_source, true;
    RETURN;
  END IF;

  IF NOT v_status = 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_IN_CONFIRMABLE_STATE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.disputes AS dispute
    WHERE dispute.shipment_id = p_shipment_id
      AND dispute.status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_HAS_ACTIVE_DISPUTE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_source = 'buyer' THEN
    SELECT buyer_id INTO v_buyer_id
    FROM public.orders
    WHERE id = v_order_id;

    IF p_actor_id IS NULL OR v_buyer_id IS DISTINCT FROM p_actor_id THEN
      RETURN QUERY SELECT false, 'BUYER_REQUIRED'::text, NULL::text, false;
      RETURN;
    END IF;
  ELSIF p_actor_id IS NOT NULL OR v_buyer_confirmed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  ELSIF v_delivered_at IS NULL
    OR NOT (v_delivered_at <= now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'AUTO_COMPLETION_NOT_DUE'::text, NULL::text, false;
    RETURN;
  END IF;

  IF NOT v_is_connect THEN
    SELECT wallet.id, wallet.available_balance
    INTO v_wallet_id, v_wallet_balance
    FROM public.wallets AS wallet
    WHERE wallet.user_id = v_seller_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'SELLER_WALLET_NOT_FOUND'::text, NULL::text, false;
      RETURN;
    END IF;

    SELECT coalesce(sum(item.net_payout), 0)
    INTO v_net_payout
    FROM public.order_items AS item
    WHERE item.shipment_id = p_shipment_id;
  END IF;

  INSERT INTO public.shipment_completion_events (
    shipment_id,
    order_id,
    source,
    actor_id,
    idempotency_key,
    completed_at,
    is_connect
  ) VALUES (
    p_shipment_id,
    v_order_id,
    p_source,
    p_actor_id,
    p_idempotency_key,
    v_completed_at,
    v_is_connect
  );

  IF NOT v_is_connect THEN
    UPDATE public.wallets
    SET pending_balance = greatest(0, pending_balance - v_net_payout),
        available_balance = available_balance + v_net_payout,
        updated_at = v_completed_at
    WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id,
      order_id,
      shipment_id,
      amount,
      net_amount,
      balance_after,
      type,
      description
    ) VALUES (
      v_wallet_id,
      v_order_id,
      p_shipment_id,
      v_net_payout,
      v_net_payout,
      v_wallet_balance + v_net_payout,
      'release',
      'Shipment completion release'
    );
  ELSE
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES (
      'INFO',
      'Connect shipment completion skipped deprecated wallet release',
      jsonb_build_object(
        'shipment_id', p_shipment_id,
        'source', p_source,
        'is_connect', true
      )
    );
  END IF;

  UPDATE public.shipments
  SET status = 'completed',
      completed_at = v_completed_at,
      buyer_confirmed_at = CASE
        WHEN p_source = 'buyer' THEN v_completed_at
        ELSE buyer_confirmed_at
      END,
      updated_at = v_completed_at
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::text, p_source, false;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES (
    'ERROR',
    'Shipment completion RPC failed',
    jsonb_build_object('shipment_id', p_shipment_id, 'sqlstate', SQLSTATE)
  );
  RETURN QUERY SELECT false, 'INTERNAL_ERROR'::text, NULL::text, false;
END;
$$;


ALTER FUNCTION "public"."fn_confirm_shipment_delivery"("p_shipment_id" "uuid", "p_source" "text", "p_actor_id" "uuid", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_create_order_from_payment"("p_buyer_id" "uuid", "p_stripe_intent_id" "text", "p_total_amount" numeric, "p_service_fee" numeric, "p_address_id" "uuid", "p_product_ids" "uuid"[]) RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$DECLARE
  v_order_id UUID;
  v_addr_snapshot JSONB;
  v_prod RECORD;
  v_seller RECORD;
  v_wallet_id UUID;
  v_wallet_pending NUMERIC;
  v_net_payout NUMERIC;
  v_commission_pct NUMERIC;
  v_isr_pct NUMERIC;
  v_iva_pct NUMERIC;
  v_sat_withholding NUMERIC;
  v_shipment_id UUID;
  v_shipments_cache JSONB := '{}'::JSONB; -- {seller_id: shipment_id}
  v_wallet_available NUMERIC;
BEGIN
  -- 1. Idempotencia
  IF EXISTS (SELECT 1 FROM public.orders WHERE stripe_payment_intent_id = p_stripe_intent_id) THEN
    RETURN QUERY SELECT true, 'ALREADY_PROCESSED'::TEXT; RETURN;
  END IF;

  -- 2. Config
  SELECT service_fee_pct, isr_withholding_pct, iva_withholding_pct
    INTO v_commission_pct, v_isr_pct, v_iva_pct
  FROM public.system_settings LIMIT 1;

  -- 3. Snapshot de dirección
  SELECT to_jsonb(a.*) INTO v_addr_snapshot FROM public.addresses a
  WHERE id = p_address_id AND user_id = p_buyer_id;

  IF v_addr_snapshot IS NULL THEN
    RETURN QUERY SELECT false, 'ADDRESS_NOT_FOUND_OR_UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 4. Crear la orden
  INSERT INTO public.orders (buyer_id, stripe_payment_intent_id, total_amount, status, shipping_address, service_fee_amount)
  VALUES (p_buyer_id, p_stripe_intent_id, p_total_amount, 'paid', v_addr_snapshot, p_service_fee)
  RETURNING id INTO v_order_id;

  -- 5. Crear shipments: uno por seller distinto
  FOR v_seller IN
    SELECT DISTINCT seller_id FROM public.products WHERE id = ANY(p_product_ids)
  LOOP
    INSERT INTO public.shipments (order_id, seller_id, status)
    VALUES (v_order_id, v_seller.seller_id, 'paid')
    RETURNING id INTO v_shipment_id;

    v_shipments_cache := jsonb_set(
      v_shipments_cache,
      ARRAY[v_seller.seller_id::TEXT],
      to_jsonb(v_shipment_id)
    );
  END LOOP;

  -- 6. Procesar cada producto
  FOR v_prod IN
    SELECT id, name, price, seller_id, shipping_cost, status
    FROM public.products
    WHERE id = ANY(p_product_ids)
    FOR UPDATE
  LOOP
    IF v_prod.status IS DISTINCT FROM 'VERIFIED' THEN
      RETURN QUERY SELECT false, format('PRODUCT_NOT_AVAILABLE: %s (status: %s)', v_prod.name, v_prod.status); RETURN;
    END IF;

    v_sat_withholding := v_prod.price * (v_isr_pct + v_iva_pct);
    v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - v_sat_withholding - COALESCE(v_prod.shipping_cost, 0);

    -- Asignar shipment_id según el seller
    v_shipment_id := (v_shipments_cache ->> v_prod.seller_id::TEXT)::UUID;

    INSERT INTO public.order_items (
      order_id, product_id, seller_id, price_at_purchase,
      commission_amount, shipping_amount, net_payout, shipment_id, sat_tax_withholding
    )
    VALUES (
      v_order_id, v_prod.id, v_prod.seller_id, v_prod.price,
      (v_prod.price * v_commission_pct), COALESCE(v_prod.shipping_cost, 0),
      v_net_payout, v_shipment_id, v_sat_withholding
    );

    -- Wallet
    SELECT id, pending_balance, available_balance
      INTO v_wallet_id, v_wallet_pending, v_wallet_available
    FROM public.wallets WHERE user_id = v_prod.seller_id FOR UPDATE;

    UPDATE public.wallets
    SET pending_balance = pending_balance + v_net_payout,
        updated_at = now()
    WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description, tax_withholding
    )
    VALUES (
      v_wallet_id, v_order_id, v_shipment_id, v_prod.price, v_net_payout,
      v_wallet_available,  -- available_balance intacto (el cobro entra a pending)
      'sale_proceeds',
      'Venta: ' || v_prod.name,
      v_sat_withholding
    );

    -- Marcar vendido
    UPDATE public.products SET status = 'SOLD', updated_at = now() WHERE id = v_prod.id;

    -- Notificación vendedor
    INSERT INTO public.notifications (user_id, type, title, message, action_path)
    VALUES (v_prod.seller_id, 'success', '¡Vendido!', 'Has vendido: ' || v_prod.name, '/profile/orders/' || v_order_id);
  END LOOP;

  -- 7. Notificación comprador
  INSERT INTO public.notifications (user_id, type, title, message, action_path)
  VALUES (p_buyer_id, 'success', '¡Compra Exitosa!', 'Tu pedido ha sido confirmado.', '/profile/orders/' || v_order_id);

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;$$;


ALTER FUNCTION "public"."fn_create_order_from_payment"("p_buyer_id" "uuid", "p_stripe_intent_id" "text", "p_total_amount" numeric, "p_service_fee" numeric, "p_address_id" "uuid", "p_product_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_create_shipment_from_payment"("p_stripe_payment_intent_id" "text", "p_amount_received" bigint, "p_metadata" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED'
    USING HINT = 'Use the single-modal per-product settlement flow.';
END;
$$;


ALTER FUNCTION "public"."fn_create_shipment_from_payment"("p_stripe_payment_intent_id" "text", "p_amount_received" bigint, "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_create_shipments_from_single_payment"("p_stripe_payment_intent_id" "text", "p_stripe_charge_id" "text", "p_amount_received" bigint, "p_transfer_group" "text", "p_allocation" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_buyer_id UUID;
  v_address_id UUID;
  v_order_id UUID;
  v_total_amount NUMERIC;
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
  v_seller_gross_pesos NUMERIC;
  v_item_limit INT;
  v_item_index INT;
  v_item_commission NUMERIC;
  v_item_shipping NUMERIC;
  v_item_net NUMERIC;
  v_residual_commission NUMERIC := 0;
  v_residual_shipping NUMERIC := 0;
  v_residual_net NUMERIC := 0;
  v_order_amount NUMERIC;
  v_service_fee_amount NUMERIC := 0;
  v_failure_code TEXT;
BEGIN
  -- 1. Validate + extract structured allocation payload fields.
  v_buyer_id := (p_allocation ->> 'buyer_id')::UUID;
  v_address_id := NULLIF(p_allocation ->> 'address_id', '')::UUID;
  v_order_id := COALESCE(
    NULLIF(p_allocation ->> 'order_id', '')::UUID,
    NULLIF(p_allocation ->> 'order_group_id', '')::UUID
  );
  v_total_amount := p_amount_received / 100.0;

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
      service_fee_amount,
      total_amount,
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
      v_total_amount,
      v_addr_snapshot
    )
    RETURNING id INTO v_existing_order_id;
  ELSE
    v_order_id := v_existing_order_id;
  END IF;

  -- 5. Allocation block: shipments + order_items + product SOLD. Any failure
  --    here rolls back ONLY this block (the shell above survives) and is
  --    caught, marking the shell payment_processing=true for admin recovery.
  BEGIN
    -- Include numeric aggregation in the recovery boundary: malformed
    -- commission data must leave a durable payment_processing shell too.
    SELECT COALESCE(SUM((r->>'commission_cents')::BIGINT), 0)
      INTO v_service_fee_amount
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
        AND status = 'RESERVED';

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
        shipping_cost
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
      v_seller_gross_pesos := v_gross_cents / 100.0;
      v_item_limit := v_expected_product_count;
      v_residual_commission := v_commission_cents / 100.0;
      v_residual_shipping := v_shipping_cents / 100.0;
      v_residual_net := v_net_cents / 100.0;

      v_item_index := 0;
      FOR v_product_record IN
        SELECT id, price
        FROM public.products
        WHERE id = ANY(v_product_ids)
          AND seller_id = v_seller_id
          AND status = 'RESERVED'
        ORDER BY id
        FOR UPDATE
      LOOP
        v_item_index := v_item_index + 1;
        IF v_item_index = v_item_limit THEN
          -- Last item: absorb the exact residual so the row sums reconcile.
          v_item_commission := v_residual_commission;
          v_item_shipping := v_residual_shipping;
          v_item_net := v_residual_net;
        ELSE
          v_item_commission := round(
            (v_commission_cents / 100.0) * (v_product_record.price / v_seller_gross_pesos),
            2
          );
          v_item_shipping := round(
            (v_shipping_cents / 100.0) * (v_product_record.price / v_seller_gross_pesos),
            2
          );
          v_item_net := round(
            (v_net_cents / 100.0) * (v_product_record.price / v_seller_gross_pesos),
            2
          );
          v_residual_commission := v_residual_commission - v_item_commission;
          v_residual_shipping := v_residual_shipping - v_item_shipping;
          v_residual_net := v_residual_net - v_item_net;
        END IF;

        INSERT INTO public.order_items (
          order_id,
          shipment_id,
          seller_id,
          product_id,
          price_at_purchase,
          commission_amount,
          shipping_amount,
          shipping_payer,
          net_payout
        ) VALUES (
          v_existing_order_id,
          v_shipment_id,
          v_seller_id,
          v_product_record.id,
          v_product_record.price,
          v_item_commission,
          v_item_shipping,
          'seller',
          v_item_net
        )
        ON CONFLICT DO NOTHING;
      END LOOP;

      -- Mark the row's RESERVED products SOLD only after their order_items
      -- are durably persisted (preserves the spec invariant).
      UPDATE public.products
      SET status = 'SOLD', updated_at = now()
      WHERE id = ANY(v_product_ids)
        AND seller_id = v_seller_id
        AND status = 'RESERVED';

      -- Advance THIS shipment to 'paid' now that its allocation is durable.
      UPDATE public.shipments
      SET status = 'paid', updated_at = now()
      WHERE id = v_shipment_id
        AND status = 'preparing';
    END LOOP;

    -- All shipments are durable; pin the order's fee tally and derive status.
    UPDATE public.orders
    SET service_fee_amount = COALESCE(v_service_fee_amount / 100.0, 0),
        total_amount = v_total_amount,
        updated_at = now()
    WHERE id = v_existing_order_id;

    PERFORM fn_derive_order_status(v_existing_order_id);

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
    -- order_item/SOLD writes persist); the shell above survives. Surface it
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
$$;


ALTER FUNCTION "public"."fn_create_shipments_from_single_payment"("p_stripe_payment_intent_id" "text", "p_stripe_charge_id" "text", "p_amount_received" bigint, "p_transfer_group" "text", "p_allocation" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cron_dispute_payout_timeout"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$DECLARE
    v_dispute RECORD;
    v_success BOOLEAN;
    v_err TEXT;
    v_is_connect BOOLEAN;
BEGIN
    -- Buscar disputas donde el vendedor no ha pagado la guía tras 48h de ser aprobada
    FOR v_dispute IN
        SELECT d.id, d.order_id, d.buyer_id, d.seller_id, d.shipment_id
        FROM public.disputes d
        WHERE d.status = 'waiting_return'
          AND d.return_payout_status = 'pending'
          AND d.updated_at < (now() - interval '48 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            IF v_dispute.shipment_id IS NOT NULL THEN
                -- Connect guard: check if the shipment was paid via Stripe Connect.
                -- If so, skip fn_complete_shipment_refund (wallet ops) and just
                -- resolve the dispute directly. Connect handles funds via Stripe.
                SELECT EXISTS(
                    SELECT 1 FROM public.shipments
                    WHERE id = v_dispute.shipment_id
                      AND stripe_payment_intent_id IS NOT NULL
                ) INTO v_is_connect;

                IF v_is_connect THEN
                    -- Connect path: resolve dispute without touching wallets
                    UPDATE public.disputes
                    SET status = 'resolved',
                        resolution_type = 'buyer_wins_timeout',
                        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador (Connect).',
                        updated_at = now()
                    WHERE id = v_dispute.id;

                    INSERT INTO public.notifications (user_id, type, title, message, action_path)
                    VALUES
                        (v_dispute.buyer_id, 'success', 'Disputa Ganada', 'El vendedor no pagó la guía de retorno a tiempo. Se procesará tu reembolso.', '/profile/orders/' || v_dispute.order_id),
                        (v_dispute.seller_id, 'error', 'Disputa Perdida', 'No pagaste la guía de retorno a tiempo. El caso se cerró a favor del comprador.', '/profile/orders/' || v_dispute.order_id);

                    v_success := true;
                ELSE
                    -- Legacy path: wallet rollback via fn_complete_shipment_refund
                    SELECT success, error_message INTO v_success, v_err
                    FROM public.fn_complete_shipment_refund(v_dispute.shipment_id);

                    IF v_success THEN
                        UPDATE public.disputes
                        SET resolution_type = 'buyer_wins_timeout',
                            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador.',
                            updated_at = now()
                        WHERE id = v_dispute.id;
                    END IF;
                END IF;

                IF NOT v_success THEN
                    INSERT INTO public.system_logs (level, message, metadata)
                    VALUES ('WARNING', 'Cron payout timeout: refund failed',
                            jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));
                END IF;
            ELSE
                -- Pre-migration fallback: disputa sin shipment_id
                -- Marcar resuelta y notificar manualmente (no hay fn para esto)
                UPDATE public.disputes
                SET status = 'resolved',
                    resolution_type = 'buyer_wins_timeout',
                    admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor no pagó guía en 48h. Caso cerrado a favor del comprador.',
                    updated_at = now()
                WHERE id = v_dispute.id;

                INSERT INTO public.notifications (user_id, type, title, message, action_path)
                VALUES
                    (v_dispute.buyer_id, 'success', 'Disputa Ganada', 'El vendedor no pagó la guía de retorno a tiempo. Tu reembolso será procesado.', '/profile/orders/' || v_dispute.order_id),
                    (v_dispute.seller_id, 'error', 'Disputa Perdida', 'No pagaste la guía de retorno a tiempo. El caso se cerró a favor del comprador.', '/profile/orders/' || v_dispute.order_id);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Atrapar excepciones DB sin abortar el resto del lote
            INSERT INTO public.system_logs (level, message, metadata)
            VALUES ('ERROR', 'Cron payout timeout: DB exception',
                    jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
        END;
    END LOOP;
END;$$;


ALTER FUNCTION "public"."fn_cron_dispute_payout_timeout"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cron_dispute_shipping_timeout"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$DECLARE
    v_dispute RECORD;
    v_success BOOLEAN;
    v_err TEXT;
BEGIN
    -- Buscar disputas donde el vendedor YA pagó, pero el comprador no ha enviado tras 48h
    FOR v_dispute IN
        SELECT d.id, d.order_id, d.buyer_id, d.seller_id, d.shipment_id
        FROM public.disputes d
        WHERE d.status = 'waiting_return'
          AND d.return_payout_status = 'paid'
          AND d.return_tracking_number IS NULL
          AND d.updated_at < (now() - interval '48 hours')
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            IF v_dispute.shipment_id IS NOT NULL THEN
                -- fn_release_shipment_funds hace TODO atómicamente:
                -- wallet release (pending→available), ledger, shipment→completed (trigger→order)
                -- NO resuelve la disputa ni notifica — eso es responsabilidad del cron.
                SELECT success, error_message INTO v_success, v_err
                FROM public.fn_release_shipment_funds(v_dispute.shipment_id);

                IF v_success THEN
                    -- Marcar disputa resuelta a favor del vendedor
                    UPDATE public.disputes
                    SET status = 'resolved',
                        resolution_type = 'seller_wins_timeout',
                        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Comprador no envió el retorno en 48h. Caso cerrado a favor del vendedor.',
                        updated_at = now()
                    WHERE id = v_dispute.id;

                    -- Notificar
                    INSERT INTO public.notifications (user_id, type, title, message, action_path)
                    VALUES
                        (v_dispute.seller_id, 'success', 'Disputa Ganada', 'El comprador no envió el retorno a tiempo. Tus fondos han sido liberados.', '/profile/orders/' || v_dispute.order_id),
                        (v_dispute.buyer_id, 'error', 'Disputa Perdida', 'No enviaste el producto a tiempo. El caso ha sido cerrado.', '/profile/orders/' || v_dispute.order_id);
                ELSE
                    -- Fallo lógico: no resolver, no notificar. Reintentar en próximo run.
                    INSERT INTO public.system_logs (level, message, metadata)
                    VALUES ('WARNING', 'Cron shipping timeout: release failed',
                            jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err));
                END IF;
            ELSE
                -- Data integrity issue: disputa activa sin shipment_id — requiere intervención manual
                INSERT INTO public.system_logs (level, message, metadata)
                VALUES ('ERROR', 'Cron shipping timeout: dispute without shipment_id — requires manual intervention',
                        jsonb_build_object('dispute_id', v_dispute.id, 'order_id', v_dispute.order_id));
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Atrapar excepciones DB sin abortar el resto del lote
            INSERT INTO public.system_logs (level, message, metadata)
            VALUES ('ERROR', 'Cron shipping timeout: DB exception',
                    jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
        END;
    END LOOP;
END;$$;


ALTER FUNCTION "public"."fn_cron_dispute_shipping_timeout"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_cron_release_shipment_funds"() RETURNS TABLE("total_processed" integer, "total_errors" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_shipment_id   UUID;
  v_processed     INT := 0;
  v_errors        INT := 0;
  v_success       BOOLEAN;
  v_error_message TEXT;
BEGIN
  -- Find legacy (pre-Connect) shipments in 'delivered' status older than 48 hours without active disputes
  FOR v_shipment_id IN
    SELECT s.id
    FROM public.shipments s
    WHERE s.status = 'delivered'
      AND s.stripe_payment_intent_id IS NULL -- Connect Guard: ignore new orders
      AND s.delivered_at < now() - interval '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.disputes d
        WHERE d.shipment_id = s.id
          AND d.status NOT IN ('resolved', 'rejected')
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- We call the release function which is now fully schema-qualified and protected
      SELECT success, error_message INTO v_success, v_error_message
      FROM public.fn_release_shipment_funds(v_shipment_id);

      IF v_success THEN
        v_processed := v_processed + 1;
      ELSE
        INSERT INTO public.system_logs (level, message, metadata)
        VALUES ('WARNING', 'Cron release-shipment-funds: fallo lógico en shipment',
                jsonb_build_object('shipment_id', v_shipment_id, 'error', v_error_message));
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('ERROR', 'Cron release-shipment-funds: excepción física en shipment',
              jsonb_build_object('shipment_id', v_shipment_id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Cron release-shipment-funds completado',
          jsonb_build_object('processed', v_processed, 'errors', v_errors));

  RETURN QUERY SELECT v_processed, v_errors;
END;
$$;


ALTER FUNCTION "public"."fn_cron_release_shipment_funds"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_cron_release_shipment_funds"() IS 'DEPRECATED by Stripe Connect migration. Cron unscheduled. Remove in cleanup phase.';



CREATE OR REPLACE FUNCTION "public"."fn_cron_return_delivery_timeout"() RETURNS TABLE("total_processed" integer, "total_errors" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$DECLARE
  v_dispute    RECORD;
  v_processed  INT := 0;
  v_errors     INT := 0;
  v_success    BOOLEAN;
  v_err_msg    TEXT;
  v_is_connect BOOLEAN;
BEGIN
  FOR v_dispute IN
    SELECT d.id, d.shipment_id, d.buyer_id, d.seller_id, d.order_id
    FROM public.disputes d
    WHERE d.status = 'return_delivered'
      AND d.return_delivered_at < now() - interval '48 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Connect guard: if the shipment was paid via Stripe Connect,
      -- skip fn_complete_shipment_refund (wallet ops). Connect refunds
      -- are handled by resolve-dispute-refund with reverse_transfer.
      SELECT EXISTS(
        SELECT 1 FROM public.shipments
        WHERE id = v_dispute.shipment_id
          AND stripe_payment_intent_id IS NOT NULL
      ) INTO v_is_connect;

      IF v_is_connect THEN
        -- Connect path: just mark dispute resolved, no wallet ops needed.
        -- The actual refund should be triggered by resolve-dispute-refund.
        UPDATE public.disputes
        SET status = 'resolved',
            resolution_type = 'buyer_wins_timeout',
            admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Retorno entregado + 48h timeout. Refund pendiente de ejecución manual (Connect).',
            updated_at = now()
        WHERE id = v_dispute.id;

        INSERT INTO public.notifications (user_id, type, title, message, action_path)
        VALUES
          (v_dispute.buyer_id, 'success', 'Devolución Recibida', 'El vendedor recibió el producto. Tu reembolso está pendiente de procesamiento.', '/profile/orders/' || v_dispute.order_id);

        v_processed := v_processed + 1;
      ELSE
        -- Legacy path: wallet rollback via fn_complete_shipment_refund
        SELECT * INTO v_success, v_err_msg
        FROM public.fn_complete_shipment_refund(v_dispute.shipment_id);

        IF v_success THEN
          v_processed := v_processed + 1;
        ELSE
          INSERT INTO public.system_logs (level, message, metadata)
          VALUES ('WARNING', 'Cron return-delivery-timeout: fallo en dispute',
                  jsonb_build_object('dispute_id', v_dispute.id, 'shipment_id', v_dispute.shipment_id, 'error', v_err_msg));
          v_errors := v_errors + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.system_logs (level, message, metadata)
      VALUES ('ERROR', 'Cron return-delivery-timeout: excepción física',
              jsonb_build_object('dispute_id', v_dispute.id, 'error', SQLERRM));
      v_errors := v_errors + 1;
    END;
  END LOOP;

  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Cron return-delivery-timeout completado',
          jsonb_build_object('processed', v_processed, 'errors', v_errors));

  RETURN QUERY SELECT v_processed, v_errors;
END;$$;


ALTER FUNCTION "public"."fn_cron_return_delivery_timeout"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_current_account_is_active"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
SELECT NOT EXISTS (
    SELECT 1
    FROM public.profiles_private
    WHERE id = (SELECT auth.uid())
    AND status IN ('suspended', 'banned')
);
$$;


ALTER FUNCTION "public"."fn_current_account_is_active"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_decide_rejected_payout_stage_park"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text", "p_failure_reason" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_status TEXT;
  v_stage TEXT;
  v_payout_id TEXT;
  v_paid_at TIMESTAMPTZ;
  v_failed_at TIMESTAMPTZ;
  v_claim_token TEXT;
  v_claim_expires_at TIMESTAMPTZ;
  v_version INTEGER;
  v_reason TEXT;
BEGIN
  IF p_target_stage NOT IN ('payout_pending', 'payout_in_transit') THEN
    RAISE EXCEPTION 'UNSUPPORTED_PROGRESS_STAGE';
  END IF;
  IF p_payout_id IS NULL OR btrim(p_payout_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_PAYOUT_ID';
  END IF;

  SELECT cpr.status, cpr.release_stage, cpr.stripe_payout_id,
         cpr.paid_at, cpr.failed_at, cpr.payout_claim_token, cpr.payout_claim_expires_at,
         cpr.release_stage_version, cpr.failure_reason
    INTO v_status, v_stage, v_payout_id, v_paid_at, v_failed_at, v_claim_token,
         v_claim_expires_at, v_version, v_reason
    FROM public.connect_payout_runs cpr
    WHERE cpr.id = p_run_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'identity_conflict';
  END IF;

  IF v_status = 'paid' AND v_stage = 'paid_observed'
    AND v_payout_id = p_payout_id AND v_paid_at IS NOT NULL
    AND v_claim_token IS NULL AND v_claim_expires_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      LEFT JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = p_run_id
        AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'paid'
          OR s.id IS NULL OR s.stripe_payout_id IS DISTINCT FROM p_payout_id)
    ) THEN
    RETURN 'superseded_paid';
  END IF;

  IF v_status = 'failed' AND v_stage = 'payout_failed'
    AND v_payout_id = p_payout_id AND v_failed_at IS NOT NULL
    AND v_claim_token IS NULL AND v_claim_expires_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      LEFT JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = p_run_id
        AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'failed'
          OR s.id IS NULL OR s.stripe_payout_id IS NOT NULL)
    ) THEN
    RETURN 'superseded_failed';
  END IF;

  -- Preserve the payout identity while durably flagging a genuine mismatch.
  IF v_payout_id IS DISTINCT FROM p_payout_id THEN
    IF v_status IS DISTINCT FROM 'reconciliation_needed'
      OR v_stage IS DISTINCT FROM 'action_required'
      OR v_reason IS DISTINCT FROM 'PAYOUT_STAGE_PAYOUT_ID_MISMATCH'
      OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL THEN
      UPDATE public.connect_payout_runs
      SET status = 'reconciliation_needed',
          release_stage = 'action_required',
          release_stage_version = v_version + 1,
          failure_reason = 'PAYOUT_STAGE_PAYOUT_ID_MISMATCH',
          payout_claim_token = NULL,
          payout_claim_expires_at = NULL,
          updated_at = now()
      WHERE id = p_run_id AND release_stage_version = v_version;
    END IF;
    RETURN 'identity_conflict';
  END IF;

  -- Keep the first park's reason on exact repeat; a changed reason is a new
  -- decision and consumes the monotonic stage version.
  IF v_status IS DISTINCT FROM 'reconciliation_needed'
    OR v_stage IS DISTINCT FROM 'action_required'
    OR v_reason IS DISTINCT FROM COALESCE(p_failure_reason, v_reason)
    OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL THEN
    UPDATE public.connect_payout_runs
    SET status = 'reconciliation_needed',
        release_stage = 'action_required',
        release_stage_version = v_version + 1,
        failure_reason = COALESCE(p_failure_reason, failure_reason),
        payout_claim_token = NULL,
        payout_claim_expires_at = NULL,
        updated_at = now()
    WHERE id = p_run_id AND release_stage_version = v_version;
  END IF;
  RETURN 'parked';
END;
$$;


ALTER FUNCTION "public"."fn_decide_rejected_payout_stage_park"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text", "p_failure_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_decide_rejected_payout_stage_park"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text", "p_failure_reason" "text") IS 'Locked stage-conflict decision: complete same-payout paid is evidence-only; mismatched identity parks without changing payout id, every other refusal parks atomically without erasing terminal timestamps. Server-only.';



CREATE OR REPLACE FUNCTION "public"."fn_defer_awaiting_balance_run"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_backoff_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deferred BOOLEAN;
BEGIN
  IF p_backoff_seconds IS NULL OR p_backoff_seconds < 60 OR p_backoff_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_BACKOFF_SECONDS';
  END IF;

  UPDATE public.connect_payout_runs
  SET next_attempt_at = now() + make_interval(secs => p_backoff_seconds),
      attempt_count = attempt_count + 1,
      last_error = 'insufficient_balance',
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_run_id
    AND payout_claim_token = p_claim_token
    -- Version-conditional so a stale worker cannot defer a newer claim.
    AND release_stage_version = p_expected_stage_version
    -- The deferral itself is a claim-gated write: a lapsed lease means the
    -- worker lost ownership and must not defer the run.
    AND payout_claim_expires_at IS NOT NULL
    AND payout_claim_expires_at > now()
    AND release_stage = 'awaiting_connected_balance'
    AND stripe_payout_id IS NULL
  RETURNING TRUE INTO v_deferred;

  RETURN COALESCE(v_deferred, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_defer_awaiting_balance_run"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_backoff_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_defer_awaiting_balance_run"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_backoff_seconds" integer) IS 'Defers an awaiting-balance run whose connected available balance is insufficient: bounded backoff sets next_attempt_at, increments the attempt count, and clears the claim so the current batch cannot re-claim it and newer eligible runs keep progressing. Conditional on the exact claim token, the expected stage version, and an unexpired lease so a stale worker cannot defer a newer claim. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_derive_order_status"("p_order_id" "uuid") RETURNS "public"."order_status_enum"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_statuses public.order_status_enum[];
BEGIN
  -- Obtenemos de forma fidedigna (bypassando RLS) todos los estados de los paquetes del pedido
  SELECT array_agg(DISTINCT s.status)
  INTO v_statuses
  FROM public.shipments s
  WHERE s.order_id = p_order_id;

  -- Si se calcula antes de que se creen los shipments, se asume pendiente
  IF v_statuses IS NULL THEN
    RETURN 'pending';
  END IF;

  -- 1. Estados excepcionales (cualquier shipment afectado contamina el estado global por seguridad)
  IF 'dispute'    = ANY(v_statuses) THEN RETURN 'dispute';  END IF;
  IF 'refunded'   = ANY(v_statuses) THEN RETURN 'refunded'; END IF;
  IF 'cancelled'  = ANY(v_statuses) THEN RETURN 'cancelled'; END IF;

  -- 2. Progreso logístico (el cuello de botella o paquete menos avanzado manda en la visualización general)
  IF 'paid'       = ANY(v_statuses) THEN RETURN 'paid';      END IF;
  IF 'preparing'  = ANY(v_statuses) THEN RETURN 'preparing'; END IF;
  IF 'shipped'    = ANY(v_statuses) THEN RETURN 'shipped';   END IF;
  IF 'delivered'  = ANY(v_statuses) THEN RETURN 'delivered'; END IF;

  -- 3. Todos los paquetes completados de forma unánime
  IF 'completed'  = ALL(v_statuses) THEN RETURN 'completed'; END IF;

  RETURN 'paid';
END;
$$;


ALTER FUNCTION "public"."fn_derive_order_status"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_fail_payout_create_from_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_failure_reason" "text", "p_claim_token" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET release_stage = 'payout_failed',
      release_stage_version = release_stage_version + 1,
      status = 'failed',
      failure_reason = p_failure_reason,
      failed_at = now(),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Token-conditional when the caller holds an executor claim; the manual
      -- release path passes NULL and is owned by the version-conditioned
      -- payout_create_in_progress fence stage.
      AND (
        p_claim_token IS NULL
        OR (
          payout_claim_token = p_claim_token
          AND payout_claim_expires_at > now()
        )
      )
      AND release_stage_version = p_expected_stage_version
      AND release_stage = 'payout_create_in_progress'
      AND stripe_payout_id IS NULL
  RETURNING TRUE INTO v_updated;

  IF v_updated THEN
    -- The aggregate and its shipment mappings move together: a definitive
    -- Stripe rejection maps the run's pending mappings to failed.
    UPDATE public.connect_payout_run_shipments
    SET status = 'failed',
        updated_at = now()
      WHERE run_id = p_run_id
        AND status IN ('pending_reconciliation');
  END IF;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_fail_payout_create_from_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_failure_reason" "text", "p_claim_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_fail_payout_create_from_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_failure_reason" "text", "p_claim_token" "text") IS 'Records a definitive Stripe payout create rejection from inside the fence: the run takes Phase 2A failed semantics (no payout object was created), the claim clears, and the admin retry flow remains authoritative. Token- and version-conditional. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_finalize_checkout_recovery"("p_stripe_payment_intent_id" "text", "p_stripe_refund_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    UPDATE public.checkout_recovery_shells
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
      SELECT 1 FROM public.checkout_recovery_shells
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
    UPDATE public.checkout_recovery_shells
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
    AND p.status = 'RESERVED'
  ORDER BY p.id
  FOR UPDATE;

  UPDATE public.products p
  SET status = 'VERIFIED', reserved_at = NULL, updated_at = now()
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id
    AND oi.product_id = p.id
    AND p.status = 'RESERVED';

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
$$;


ALTER FUNCTION "public"."fn_finalize_checkout_recovery"("p_stripe_payment_intent_id" "text", "p_stripe_refund_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_finalize_shipment_label"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_envia_shipment_id" "text", "p_tracking_number" "text", "p_label_url" "text", "p_carrier" "text", "p_service" "text", "p_print_format" "text", "p_print_size" "text", "p_provider_cost_cents" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF p_envia_shipment_id IS NULL OR p_tracking_number IS NULL OR p_label_url IS NULL OR p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0 OR lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress' OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground' THEN RAISE EXCEPTION 'INVALID_PROVIDER_RESULT'; END IF;
  UPDATE public.shipments SET envia_shipment_id = p_envia_shipment_id, tracking_number = p_tracking_number, label_url = p_label_url, carrier = p_carrier, service = p_service, print_format = p_print_format, print_size = p_print_size, label_provider_cost_cents = p_provider_cost_cents, label_generation_state = 'generated', status = 'preparing', label_generated_at = now(), claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_shipment_id AND status = 'paid' AND label_generation_state = 'generation_sent' AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'generated');
  RETURN true;
END; $$;


ALTER FUNCTION "public"."fn_finalize_shipment_label"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_envia_shipment_id" "text", "p_tracking_number" "text", "p_label_url" "text", "p_carrier" "text", "p_service" "text", "p_print_format" "text", "p_print_size" "text", "p_provider_cost_cents" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_get_admin_payout_queue"("p_search" "text" DEFAULT ''::"text", "p_bucket" "text" DEFAULT 'ready'::"text", "p_page" integer DEFAULT 0, "p_scope" "text" DEFAULT 'page'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_search TEXT := btrim(COALESCE(p_search, ''));
  v_result JSONB;
BEGIN
  IF p_bucket IS NULL OR p_bucket NOT IN ('ready', 'processing', 'action-required', 'history') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_BUCKET';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('page', 'selection') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_SCOPE';
  END IF;
  IF p_page IS NULL OR p_page < 0 THEN
    RAISE EXCEPTION 'INVALID_QUEUE_PAGE';
  END IF;
  IF p_scope = 'selection' AND p_bucket NOT IN ('ready', 'action-required') THEN
    RAISE EXCEPTION 'QUEUE_SELECTION_NOT_ALLOWED';
  END IF;

  WITH queue_rows AS MATERIALIZED (
    SELECT q.*,
      to_jsonb(q) AS row_data,
      CASE WHEN q.payout_run_id IS NULL
        THEN 'seller:' || q.seller_id::TEXT
        ELSE 'run:' || q.payout_run_id::TEXT END AS queue_group_id,
      CASE WHEN q.payout_run_id IS NULL THEN 0
        WHEN q.payout_run_status = 'paid' THEN 1
        WHEN q.payout_run_status = 'pending_reconciliation' THEN 2
        ELSE 3 END AS bucket_rank
    FROM public.admin_connect_payout_release_view q
    WHERE (q.payout_run_id IS NOT NULL OR
      (q.seller_id IS NOT NULL AND q.shipment_id IS NOT NULL AND q.order_id IS NOT NULL))
      AND (v_search = '' OR strpos(lower(COALESCE(q.seller_name, '')), lower(v_search)) > 0)
  ), groups AS (
    SELECT queue_group_id,
      CASE MAX(bucket_rank) WHEN 0 THEN 'ready' WHEN 1 THEN 'history'
        WHEN 2 THEN 'processing' ELSE 'action-required' END AS bucket,
      MIN(seller_name) AS seller_name,
      MAX(payout_run_paid_at) AS paid_at,
      CASE WHEN MAX(bucket_rank) = 0 THEN
        BOOL_OR(is_eligible IS TRUE AND release_amount_cents > 0)
      ELSE BOOL_AND(COALESCE(payout_run_status = 'failed', FALSE) AND COALESCE(is_retryable, FALSE))
      END AS selectable
    FROM queue_rows
    GROUP BY queue_group_id
  ), counts AS (
    SELECT jsonb_build_object(
      'ready', COUNT(*) FILTER (WHERE bucket = 'ready'),
      'processing', COUNT(*) FILTER (WHERE bucket = 'processing'),
      'action-required', COUNT(*) FILTER (WHERE bucket = 'action-required'),
      'history', COUNT(*) FILTER (WHERE bucket = 'history')
    ) AS value FROM groups
  ), matching_groups AS (
    SELECT * FROM groups WHERE bucket = p_bucket
  ), bounds AS (
    SELECT COUNT(*) AS total_groups,
      GREATEST((COUNT(*) + 19) / 20, 1) AS total_pages,
      LEAST(p_page::BIGINT, GREATEST((COUNT(*) + 19) / 20 - 1, 0)) AS page
    FROM matching_groups
  ), ranked_groups AS (
    SELECT g.*, ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN p_bucket = 'history' THEN paid_at END DESC NULLS LAST,
        CASE WHEN p_bucket = 'history' THEN queue_group_id END DESC,
        CASE WHEN p_bucket <> 'history' THEN lower(seller_name) END COLLATE "C" ASC NULLS LAST,
        queue_group_id ASC
    ) AS position
    FROM matching_groups g
  ), chosen_groups AS (
    SELECT g.* FROM ranked_groups g CROSS JOIN bounds b
    WHERE (p_scope = 'selection' AND g.selectable)
      OR (p_scope = 'page' AND g.position > b.page * 20
        AND g.position <= (b.page + 1) * 20)
  ), chosen_rows AS (
    SELECT COALESCE(
      jsonb_agg(r.row_data ORDER BY g.position, r.completed_at, r.shipment_id),
      '[]'::JSONB
    ) AS value
    FROM queue_rows r
    JOIN chosen_groups g ON g.queue_group_id = r.queue_group_id
  )
  SELECT jsonb_build_object(
    'rows', r.value,
    'counts', c.value,
    'bucket', p_bucket,
    'scope', p_scope,
    'page', CASE WHEN p_scope = 'page' THEN b.page ELSE 0 END,
    'pageSize', 20,
    'totalGroups', b.total_groups,
    'totalPages', b.total_pages,
    'selectedGroupCount', CASE WHEN p_scope = 'selection'
      THEN (SELECT COUNT(*) FROM chosen_groups) ELSE 0 END,
    'selectionComplete', p_scope = 'selection'
  ) INTO v_result
  FROM bounds b CROSS JOIN counts c CROSS JOIN chosen_rows r;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."fn_get_admin_payout_queue"("p_search" "text", "p_bucket" "text", "p_page" integer, "p_scope" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_get_admin_payout_queue"("p_search" "text", "p_bucket" "text", "p_page" integer, "p_scope" "text") IS 'Admin service-only read: complete seller/run group pages or all selectable matching groups. Selection does not authorize money movement.';



CREATE OR REPLACE FUNCTION "public"."fn_get_connect_account_actionability"("p_stripe_account_id" "text") RETURNS TABLE("is_actionable" boolean, "blocked_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  LEFT JOIN public.connect_account_actionability caa
    ON caa.stripe_account_id = p_stripe_account_id;
END;
$$;


ALTER FUNCTION "public"."fn_get_connect_account_actionability"("p_stripe_account_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_get_connect_account_actionability"("p_stripe_account_id" "text") IS 'RPC-only payout gate, pending refresh returns FALSE/account_refresh_pending, including after retrieval error. Existing no-row TRUE compatibility is preserved; existing blocked rows are never bulk-enabled.';



CREATE OR REPLACE FUNCTION "public"."fn_get_location_by_zip"("p_zip" "text") RETURNS TABLE("state_code" "text", "state_name" "text", "city" "text", "districts" "text"[])
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.state_code, 
        m.state_name, 
        m.city, 
        array_agg(m.district) as districts
    FROM public.mexico_zips m
    WHERE m.zip_code = p_zip
    GROUP BY m.state_code, m.state_name, m.city;
END;
$$;


ALTER FUNCTION "public"."fn_get_location_by_zip"("p_zip" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_lock_dispute"("p_dispute_id" "uuid") RETURNS TABLE("success" boolean, "locker_name" "text", "locked_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_current_locker_id UUID;
    v_current_locker_name TEXT;
    v_current_locked_at TIMESTAMPTZ;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION'; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    SELECT d.locked_by, p.username, d.locked_at
    INTO v_current_locker_id, v_current_locker_name, v_current_locked_at
    FROM public.disputes d
    LEFT JOIN public.profiles p ON p.id = d.locked_by
    WHERE d.id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'DISPUTE_NOT_FOUND'; END IF;

    -- Caso 1: Libre o expirado
    IF v_current_locker_id IS NULL OR v_current_locked_at < (now() - interval '10 minutes') THEN
        UPDATE public.disputes SET locked_by = v_auth_user_id, locked_at = now() WHERE id = p_dispute_id;

        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_LOCK_ACQUIRED', p_dispute_id, jsonb_build_object('prev_locker', v_current_locker_id));

        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;

    -- Caso 2: Ya es mío (Renovación - FIX APLICADO)
    ELSIF v_current_locker_id = v_auth_user_id THEN
        UPDATE public.disputes SET locked_at = now() WHERE id = p_dispute_id;

        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_LOCK_RENEWED', p_dispute_id, jsonb_build_object('timestamp', now()));

        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;

    -- Caso 3: Ocupado
    ELSE
        RETURN QUERY SELECT false, v_current_locker_name, v_current_locked_at;
    END IF;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_lock_dispute', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
$$;


ALTER FUNCTION "public"."fn_lock_dispute"("p_dispute_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_lock_product"("p_product_id" "uuid") RETURNS TABLE("success" boolean, "locked_by_username" "text", "locked_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_locker_id UUID;
    v_locker_name TEXT;
    v_lock_time TIMESTAMPTZ;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    IF NOT is_admin() THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    SELECT p.locked_by, p.locked_at
    INTO v_locker_id, v_lock_time
    FROM public.products p
    WHERE p.id = p_product_id
    FOR UPDATE;

    IF v_locker_id IS NOT NULL THEN
        SELECT username INTO v_locker_name
        FROM public.profiles
        WHERE id = v_locker_id;
    END IF;

    IF v_locker_id IS NULL OR v_lock_time < (now() - interval '10 minutes') THEN
        UPDATE public.products
        SET locked_by = v_auth_user_id, locked_at = now()
        WHERE id = p_product_id;
        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSIF v_locker_id = v_auth_user_id THEN
        UPDATE public.products
        SET locked_at = now()
        WHERE id = p_product_id;
        RETURN QUERY SELECT true, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSE
        RETURN QUERY SELECT false, v_locker_name, v_lock_time;
    END IF;
END;
$$;


ALTER FUNCTION "public"."fn_lock_product"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_log_return_payment"("p_dispute_id" "uuid", "p_stripe_id" "text", "p_amount" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$-- =========================================================================

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
END;$$;


ALTER FUNCTION "public"."fn_log_return_payment"("p_dispute_id" "uuid", "p_stripe_id" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_mark_checkout_recovery_reconciliation_needed"("p_stripe_payment_intent_id" "text", "p_error" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.orders
  SET compensation_state = 'reconciliation_needed',
      compensation_last_error = p_error,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = NULL,
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status <> 'refunded';

  IF FOUND THEN
    RETURN;
  END IF;

  UPDATE public.checkout_recovery_shells
  SET compensation_state = 'reconciliation_needed',
      compensation_last_error = p_error,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = NULL,
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND compensation_state <> 'refunded';
END;
$$;


ALTER FUNCTION "public"."fn_mark_checkout_recovery_reconciliation_needed"("p_stripe_payment_intent_id" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_mark_checkout_recovery_retry"("p_stripe_payment_intent_id" "text", "p_error" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.orders
  SET compensation_state = 'refund_failed_retry_queued',
      compensation_last_error = p_error,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = now() + interval '5 minutes',
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status <> 'refunded';

  IF FOUND THEN
    RETURN;
  END IF;

  UPDATE public.checkout_recovery_shells
  SET compensation_state = 'refund_failed_retry_queued',
      compensation_last_error = p_error,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = now() + interval '5 minutes',
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND compensation_state <> 'refunded';
END;
$$;


ALTER FUNCTION "public"."fn_mark_checkout_recovery_retry"("p_stripe_payment_intent_id" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"("p_run_id" "uuid", "p_failure_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET status = 'reconciliation_needed',
      release_stage = 'action_required',
      release_stage_version = release_stage_version + 1,
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Idempotent no-op: an already-parked run whose recorded reason is
      -- unchanged is not a new decision, so the monotonic version stays put
      -- for a repeated park.
      AND (
        status IS DISTINCT FROM 'reconciliation_needed'
        OR failure_reason IS DISTINCT FROM
          COALESCE(p_failure_reason, failure_reason)
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"("p_run_id" "uuid", "p_failure_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"("p_run_id" "uuid", "p_failure_reason" "text") IS 'Webhook reconciliation park: guarded, version-bumping write that sets status=reconciliation_needed with the compatible action_required stage, clears the executor claim and lease, and preserves paid_at/failed_at terminal evidence. A repeated park with the same reason is an idempotent no-op. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_mark_payout_run_sync_failed"("p_run_id" "uuid", "p_stripe_payout_id" "text", "p_failure_reason" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET stripe_payout_id = COALESCE(stripe_payout_id, p_stripe_payout_id),
      status = 'reconciliation_needed',
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      release_stage_version = release_stage_version + 1,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      -- Never regress terminal authority: a webhook already projected a
      -- terminal outcome (paid/failed/canceled), and this fallback must not
      -- overwrite it.
      AND status NOT IN ('paid', 'failed', 'canceled')
      -- Idempotent no-op: an already-parked run with the same recorded reason
      -- and payout id is not a new decision, so the version stays put.
      AND (
        status IS DISTINCT FROM 'reconciliation_needed'
        OR stripe_payout_id IS DISTINCT FROM
          COALESCE(stripe_payout_id, p_stripe_payout_id)
        OR failure_reason IS DISTINCT FROM
          COALESCE(p_failure_reason, failure_reason)
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_mark_payout_run_sync_failed"("p_run_id" "uuid", "p_stripe_payout_id" "text", "p_failure_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_mark_payout_run_sync_failed"("p_run_id" "uuid", "p_stripe_payout_id" "text", "p_failure_reason" "text") IS 'Post-Stripe sync fallback of the manual release path: guarded, version-bumping write that attaches the payout id when absent and parks the run at status=reconciliation_needed while preserving the durable stage (fence stays so the executor reconciliation claim recovers it), refusing a terminal status (paid/failed/canceled) so webhook terminal authority is never regressed. A repeated fallback with the same recorded reason is an idempotent no-op. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_mark_return_delivered"("p_dispute_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_status      TEXT;
  v_buyer_id    UUID;
  v_seller_id   UUID;
  v_order_id    UUID;
  v_shipment_id UUID;
  v_return_delivered_at timestamptz;
BEGIN
  -- 1. Validar dispute y aplicar Bloqueo Pesimista (FOR UPDATE) para evitar race conditions
  -- Esto evita que el cron sobreescriba un estado 'resolved' manual si el vendedor confirma al mismo milisegundo.
  SELECT d.status::TEXT, d.buyer_id, d.seller_id, d.order_id, d.shipment_id
  INTO v_status, v_buyer_id, v_seller_id, v_order_id, v_shipment_id
  FROM public.disputes d
  WHERE d.id = p_dispute_id
  FOR UPDATE; -- ← FIX CRÍTICO: Previene doble reembolso fraudulento por sobreescritura de estado

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en flujo de retorno activo (en camino o esperando envío)
  IF v_status NOT IN ('waiting_return', 'return_shipped') THEN
    RETURN QUERY SELECT false, format('INVALID_DISPUTE_STATUS: %s', v_status); RETURN;
  END IF;

  -- Verify the stored participants before publishing a trusted seller-scoped event.
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.shipments s ON s.order_id = o.id
    WHERE o.id = v_order_id AND s.id = v_shipment_id
      AND o.buyer_id = v_buyer_id AND s.seller_id = v_seller_id
  ) THEN
    RAISE EXCEPTION 'Invalid return delivery relationship';
  END IF;

  -- 3. Marcar como entregado (Inicia el reloj de 48 horas de gracia para unboxing del vendedor)
  UPDATE public.disputes
  SET status = 'return_delivered',
      return_delivered_at = clock_timestamp(),
      updated_at = now()
  WHERE id = p_dispute_id
  RETURNING return_delivered_at INTO v_return_delivered_at;

  IF v_return_delivered_at IS NULL OR v_order_id IS NULL
     OR v_buyer_id IS NULL OR v_seller_id IS NULL THEN
    RAISE EXCEPTION 'Invalid return delivery identity or recipients';
  END IF;

  INSERT INTO public.notifications (
    user_id, type, title, message, action_path,
    event_kind, source_event_key, event_payload
  )
  SELECT recipients.user_id, recipients.notice_type, recipients.title,
    recipients.message, '/profile/orders/' || v_order_id::text,
    'return.delivered',
    'return.delivered:' || p_dispute_id::text || ':' || extract(epoch FROM v_return_delivered_at)::text,
    jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id,
                       'recipient_role', recipients.recipient_role)
  FROM (VALUES
    (v_seller_id, 'seller', 'warning', 'Retorno entregado',
     'El retorno fue entregado. Revisa el producto y reporta cualquier anomalía dentro de 48 horas.'),
    (v_buyer_id, 'buyer', 'info', 'Retorno entregado',
     'Se registró la entrega del retorno. Consulta el estado de tu caso.')
  ) AS recipients(user_id, recipient_role, notice_type, title, message)
  WHERE true AND (recipients.recipient_role = 'seller' OR v_buyer_id IS DISTINCT FROM v_seller_id)
  ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_return_delivered',
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;


ALTER FUNCTION "public"."fn_mark_return_delivered"("p_dispute_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_mark_shipment_delivered"("p_shipment_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  -- 1. Validar shipment y aplicar Bloqueo Pesimista (FOR UPDATE)
  -- Esto evita condiciones de carrera si el comprador confirma manualmente al mismo milisegundo que corre el cron.
  SELECT status::TEXT INTO v_current_status
  FROM public.shipments 
  WHERE id = p_shipment_id 
  FOR UPDATE; -- ← FIX CRÍTICO: Previene la sobreescritura destructiva de estados

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Solo avanzar si está en tránsito (o empaque si se saltó el scan de tránsito)
  IF v_current_status NOT IN ('shipped', 'preparing') THEN
    RETURN QUERY SELECT false, format('INVALID_SHIPMENT_STATUS: %s', v_current_status); RETURN;
  END IF;

  -- 3. Marcar como entregado — SOLO inicia el reloj de 48h, NO libera fondos
  UPDATE public.shipments
  SET status = 'delivered',
      delivered_at = now(),
      updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_mark_shipment_delivered',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;


ALTER FUNCTION "public"."fn_mark_shipment_delivered"("p_shipment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_mark_shipment_label_orphan"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_error_class" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments
    SET label_generation_state = 'orphan_pending', claim_expires_at = NULL, updated_at = now()
    WHERE id = p_shipment_id
      AND label_generation_state IN ('claimed', 'generation_sent')
      AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, metadata)
    VALUES (p_shipment_id, 'orphaned', jsonb_build_object('errorClass', p_error_class));
  RETURN true;
END; $$;


ALTER FUNCTION "public"."fn_mark_shipment_label_orphan"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_error_class" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_mark_shipment_label_rejected"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_error_class" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  UPDATE public.shipments
    SET label_generation_state = 'retryable_rejected', claim_token = NULL,
        claim_expires_at = NULL, updated_at = now()
    WHERE id = p_shipment_id
      AND label_generation_state IN ('claimed', 'generation_sent')
      AND claim_token = p_claim_token;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, metadata)
    VALUES (p_shipment_id, 'rejected', jsonb_build_object('errorClass', p_error_class));
  RETURN true;
END; $$;


ALTER FUNCTION "public"."fn_mark_shipment_label_rejected"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_error_class" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_mark_shipment_label_sent"("p_shipment_id" "uuid", "p_claim_token" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  -- Serialize the final pre-provider boundary with cancellation claim/start.
  PERFORM 1 FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id
      AND (external_started_at IS NOT NULL OR claim_expires_at > clock_timestamp())) THEN
    RETURN false;
  END IF;
  UPDATE public.shipments SET label_generation_state = 'generation_sent', claim_expires_at = clock_timestamp() + interval '15 minutes', updated_at = now()
  WHERE id = p_shipment_id AND label_generation_state = 'claimed' AND claim_token = p_claim_token
    AND claim_expires_at > clock_timestamp()
    AND lower(label_quote_carrier) = 'paquetexpress'
    AND lower(regexp_replace(label_quote_service, '\s+', ' ', 'g')) = 'ground'
    AND label_quote_cost_cents IS NOT NULL AND label_quote_input_hash IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type) VALUES (p_shipment_id, 'sent');
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."fn_mark_shipment_label_sent"("p_shipment_id" "uuid", "p_claim_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notify_dispute_opened"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_buyer_id uuid;
  v_seller_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.status IS DISTINCT FROM 'open'
     OR NEW.shipment_id IS NULL THEN
    RAISE EXCEPTION 'Invalid dispute opened notification authority or state';
  END IF;

  SELECT o.buyer_id, s.seller_id INTO v_buyer_id, v_seller_id
  FROM public.orders o
  JOIN public.shipments s ON s.order_id = o.id
  WHERE o.id = NEW.order_id AND s.id = NEW.shipment_id;

  IF NOT FOUND OR v_buyer_id IS NULL OR v_seller_id IS NULL
     OR NEW.buyer_id IS DISTINCT FROM v_buyer_id
     OR NEW.seller_id IS DISTINCT FROM v_seller_id THEN
    RAISE EXCEPTION 'Dispute order, shipment, buyer or seller relationship invalid';
  END IF;

  IF v_seller_id IS DISTINCT FROM v_buyer_id THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, action_path,
      event_kind, source_event_key, event_payload
    ) VALUES (
      v_seller_id, 'warning', 'Disputa abierta',
      'Se abrió una disputa sobre una de tus ventas. Consulta los detalles del caso.',
      '/profile/orders/' || NEW.order_id::text,
      'dispute.opened', 'dispute.opened:' || NEW.id::text,
      jsonb_build_object('dispute_id', NEW.id, 'order_id', NEW.order_id, 'recipient_role', 'seller')
    ) ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_notify_dispute_opened"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_on_auth_user_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url, is_verified_seller)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles_private (id, email, role, status)
  VALUES (NEW.id, NEW.email, 'user', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallets (user_id, available_balance, pending_balance)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALLO CRÍTICO EN SETUP DE USUARIO: %', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."fn_on_auth_user_created"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_on_auth_user_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.profiles_private
  SET email = NEW.email,
      updated_at = now()
  WHERE id = NEW.id;

  IF NOT FOUND THEN
    RAISE WARNING 'profiles_private row missing for user %', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_on_auth_user_updated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_on_dispute_opened"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Cambiar estado de la orden
    UPDATE public.orders
    SET status = 'dispute',
        updated_at = now()
    WHERE id = NEW.order_id;

    -- Log de auditoría automático
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('INFO', 'Disputa abierta para orden', jsonb_build_object('order_id', NEW.order_id, 'dispute_id', NEW.id, 'buyer_id', NEW.buyer_id));

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_on_dispute_opened"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_persist_shipment_label_quote"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_carrier" "text", "p_service" "text", "p_quote_cost_cents" bigint, "p_quote_reference" "text", "p_input_hash" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  IF lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress'
     OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground'
     OR p_quote_cost_cents IS NULL OR p_quote_cost_cents < 0
     OR p_input_hash IS NULL OR btrim(p_input_hash) = '' THEN
    RAISE EXCEPTION 'INVALID_ACCEPTED_RATE';
  END IF;
  UPDATE public.shipments
  SET label_quote_carrier = p_carrier,
      label_quote_service = p_service,
      label_quote_cost_cents = p_quote_cost_cents,
      label_quote_reference = NULLIF(btrim(p_quote_reference), ''),
      label_quote_rated_at = now(),
      label_quote_input_hash = p_input_hash,
      updated_at = now()
  WHERE id = p_shipment_id
    AND label_generation_state = 'claimed'
    AND claim_token = p_claim_token;
  RETURN FOUND;
END; $$;


ALTER FUNCTION "public"."fn_persist_shipment_label_quote"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_carrier" "text", "p_service" "text", "p_quote_cost_cents" bigint, "p_quote_reference" "text", "p_input_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_prevent_connect_account_event_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'connect_account_events is append-only and immutable';
END;
$$;


ALTER FUNCTION "public"."fn_prevent_connect_account_event_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_prevent_connect_payout_event_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'connect_payout_events is append-only and immutable';
END;
$$;


ALTER FUNCTION "public"."fn_prevent_connect_payout_event_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_project_payout_run_stage"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stage TEXT;
  v_status TEXT;
  v_payout_id TEXT;
  v_paid_at TIMESTAMPTZ;
  v_claim_token TEXT;
  v_claim_expires_at TIMESTAMPTZ;
  v_updated BOOLEAN;
BEGIN
  IF p_target_stage NOT IN ('payout_pending', 'payout_in_transit') THEN
    RAISE EXCEPTION 'UNSUPPORTED_PROGRESS_STAGE';
  END IF;

  -- Serialize classification with terminal projection on the run row.
  SELECT cpr.release_stage, cpr.status, cpr.stripe_payout_id,
         cpr.paid_at, cpr.payout_claim_token, cpr.payout_claim_expires_at
    INTO v_stage, v_status, v_payout_id, v_paid_at,
         v_claim_token, v_claim_expires_at
    FROM public.connect_payout_runs cpr
    WHERE cpr.id = p_run_id AND cpr.stripe_payout_id = p_payout_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_status = 'paid' THEN
    IF v_payout_id IS DISTINCT FROM p_payout_id
      OR v_stage IS DISTINCT FROM 'paid_observed'
      OR v_paid_at IS NULL
      OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        LEFT JOIN public.shipments s ON s.id = m.shipment_id
        WHERE m.run_id = p_run_id
          AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'paid'
            OR s.id IS NULL OR s.stripe_payout_id IS DISTINCT FROM v_payout_id)
      ) THEN
      RETURN FALSE;
    END IF;
    -- No writes: neither the stage version nor the paid evidence changes.
    RETURN TRUE;
  END IF;

  -- A delayed or duplicate created event cannot regress healthy in-transit progress.
  -- Leave genuine action-required and claimed states to the guarded park decision.
  IF v_status = 'pending_reconciliation'
    AND v_stage = 'payout_in_transit'
    AND p_target_stage = 'payout_pending'
    AND v_claim_token IS NULL AND v_claim_expires_at IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Preserve the existing idempotent target-stage behavior for pre-terminal
  -- runs; never classify a terminal failure or an incomplete paid run here.
  IF v_status IN ('pending_reconciliation', 'reconciliation_needed')
    AND v_stage = p_target_stage THEN
    RETURN TRUE;
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = p_target_stage,
      release_stage_version = release_stage_version + 1,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id
      AND stripe_payout_id = p_payout_id
      AND release_stage IS NOT DISTINCT FROM v_stage
      AND status IN ('pending_reconciliation', 'reconciliation_needed')
      AND (
        (p_target_stage = 'payout_pending'
          AND (release_stage IS NULL OR release_stage = 'payout_create_in_progress'))
        OR (p_target_stage = 'payout_in_transit'
          AND (release_stage IS NULL OR release_stage IN (
            'payout_create_in_progress', 'payout_pending')))
      )
  RETURNING TRUE INTO v_updated;

  RETURN COALESCE(v_updated, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_project_payout_run_stage"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_project_payout_run_stage"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text") IS 'Projects signed pre-terminal progress monotonically; healthy in-transit replay of pending and late progress on a complete same-payout observed paid run are side-effect-free TRUE, while incomplete or mismatched projections remain refusals. Server-only.';



CREATE OR REPLACE FUNCTION "public"."fn_project_payout_run_terminal"("p_run_id" "uuid", "p_payout_id" "text", "p_target_status" "text", "p_occurred_at" timestamp with time zone, "p_failure_reason" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_status TEXT;
  v_stage TEXT;
  v_paid_at TIMESTAMPTZ;
  v_failed_at TIMESTAMPTZ;
  v_claim_token TEXT;
  v_claim_expires_at TIMESTAMPTZ;
  v_updated BOOLEAN;
  v_conflicting_shipment_id TEXT;
BEGIN
  IF p_target_status NOT IN ('paid', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'UNSUPPORTED_TERMINAL_STATUS';
  END IF;
  IF p_payout_id IS NULL OR btrim(p_payout_id) = '' THEN
    RAISE EXCEPTION 'MISSING_STRIPE_PAYOUT_ID';
  END IF;

  SELECT cpr.status, cpr.release_stage, cpr.paid_at, cpr.failed_at,
         cpr.payout_claim_token, cpr.payout_claim_expires_at
    INTO v_status, v_stage, v_paid_at, v_failed_at, v_claim_token, v_claim_expires_at
    FROM public.connect_payout_runs cpr
    WHERE cpr.id = p_run_id AND cpr.stripe_payout_id = p_payout_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Only an entirely projected paid run is equivalent. The run lock serializes
  -- competing terminal writers; mapped rows are checked before any no-op.
  IF v_status = 'paid' AND p_target_status = 'paid' THEN
    IF v_stage IS DISTINCT FROM 'paid_observed' OR v_paid_at IS NULL
      OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        LEFT JOIN public.shipments s ON s.id = m.shipment_id
        WHERE m.run_id = p_run_id
          AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'paid'
            OR s.id IS NULL OR s.stripe_payout_id IS DISTINCT FROM p_payout_id)
      ) THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  -- Complete failed replays preserve the original projection without writes.
  -- A retry child's payout marking is not this parent's to clear or replace.
  IF v_status = 'failed' AND p_target_status = 'failed' THEN
    IF v_stage IS DISTINCT FROM 'payout_failed' OR v_failed_at IS NULL
      OR v_claim_token IS NOT NULL OR v_claim_expires_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM public.connect_payout_run_shipments m
        LEFT JOIN public.shipments s ON s.id = m.shipment_id
        WHERE m.run_id = p_run_id
          AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'failed'
            OR s.id IS NULL OR s.stripe_payout_id IS NOT NULL)
      ) THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  -- The webhook may have read a pre-paid snapshot before this lock. Refuse
  -- older or undated failure evidence against the locked paid timestamp;
  -- FALSE follows the existing conflict/park path, not a silent no-op.
  IF v_status = 'paid' AND p_target_status = 'failed' THEN
    IF v_paid_at IS NULL OR p_occurred_at IS NULL
      OR p_occurred_at < v_paid_at THEN
      RETURN FALSE;
    END IF;
  END IF;

  UPDATE public.connect_payout_runs
  SET release_stage = CASE
        WHEN p_target_status = 'paid' THEN 'paid_observed'
        WHEN p_target_status = 'failed' THEN 'payout_failed'
        ELSE 'payout_canceled' END,
      release_stage_version = release_stage_version + 1,
      status = p_target_status,
      paid_at = CASE
        WHEN p_target_status = 'paid' AND (paid_at IS NULL OR p_occurred_at > paid_at)
          THEN p_occurred_at ELSE paid_at END,
      failed_at = CASE WHEN p_target_status IN ('failed', 'canceled')
        THEN p_occurred_at ELSE failed_at END,
      failure_reason = CASE WHEN p_target_status IN ('failed', 'canceled')
        AND p_failure_reason IS NOT NULL THEN p_failure_reason ELSE failure_reason END,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_run_id AND stripe_payout_id = p_payout_id
    AND NOT (p_target_status = 'paid' AND status IN ('failed', 'canceled'))
    AND (status NOT IN ('paid', 'failed', 'canceled')
      OR (status = 'paid' AND p_target_status = 'failed'))
  RETURNING TRUE INTO v_updated;
  IF NOT COALESCE(v_updated, FALSE) THEN
    RETURN FALSE;
  END IF;

  IF p_target_status = 'paid' THEN
    UPDATE public.connect_payout_run_shipments
    SET status = 'paid', updated_at = now()
    WHERE run_id = p_run_id AND status IN ('pending_reconciliation');
  ELSE
    UPDATE public.connect_payout_run_shipments
    SET status = p_target_status, updated_at = now()
    WHERE run_id = p_run_id AND status IN ('pending_reconciliation', 'paid');
  END IF;

  IF p_target_status = 'paid' THEN
    IF NOT EXISTS (SELECT 1 FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL) THEN
      RAISE EXCEPTION 'PAYOUT_RUN_HAS_NO_SHIPMENTS';
    END IF;
    -- Reject every incomplete mapping after the conditional mapping write.
    -- An exception rolls the run, mappings, and shipment writes back together.
    IF EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      LEFT JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = p_run_id
        AND (m.shipment_id IS NULL OR m.status IS DISTINCT FROM 'paid'
          OR s.id IS NULL)
    ) THEN
      RAISE EXCEPTION 'PAYOUT_MAPPING_INCOMPLETE';
    END IF;
    UPDATE public.shipments
    SET stripe_payout_id = p_payout_id, updated_at = now()
    WHERE id IN (SELECT m.shipment_id FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL)
      AND stripe_payout_id IS NULL;
    SELECT s.id INTO v_conflicting_shipment_id
    FROM public.connect_payout_run_shipments m
    JOIN public.shipments s ON s.id = m.shipment_id
    WHERE m.run_id = p_run_id AND s.stripe_payout_id IS NOT NULL
      AND s.stripe_payout_id <> p_payout_id LIMIT 1;
    IF v_conflicting_shipment_id IS NOT NULL THEN
      RAISE EXCEPTION 'SHIPMENT_ALREADY_RELEASED:%', v_conflicting_shipment_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.connect_payout_run_shipments m
      LEFT JOIN public.shipments s ON s.id = m.shipment_id
      WHERE m.run_id = p_run_id
        AND (m.status IS DISTINCT FROM 'paid' OR s.id IS NULL
          OR s.stripe_payout_id IS DISTINCT FROM p_payout_id)
    ) THEN
      RAISE EXCEPTION 'PAYOUT_MAPPING_INCOMPLETE';
    END IF;
  ELSE
    UPDATE public.shipments
    SET stripe_payout_id = NULL, updated_at = now()
    WHERE id IN (SELECT m.shipment_id FROM public.connect_payout_run_shipments m
      WHERE m.run_id = p_run_id AND m.shipment_id IS NOT NULL)
      AND stripe_payout_id = p_payout_id;
  END IF;
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."fn_project_payout_run_terminal"("p_run_id" "uuid", "p_payout_id" "text", "p_target_status" "text", "p_occurred_at" timestamp with time zone, "p_failure_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_project_payout_run_terminal"("p_run_id" "uuid", "p_payout_id" "text", "p_target_status" "text", "p_occurred_at" timestamp with time zone, "p_failure_reason" "text") IS 'Atomic webhook terminal projection: one SECURITY DEFINER transaction conditionally projects the run (compatible terminal stage and Phase 2A status, executor claim cleared), advances the shipment mappings with the monotonic filter (paid only from pending; failure and cancellation from pending and paid), and sets or clears the shipment payout-id markings — setting it only where unreleased (a conflicting release raises and rolls the unit back) and clearing it only where it equals the failing payout id. Returns FALSE (nothing applied) when the run does not match the payout id or the outcome would regress terminal authority. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_reconcile_connect_payments"() RETURNS TABLE("shipment_id" "uuid", "status" "text", "action" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- Find shipments in 'paid' status older than 1 hour that have no
  -- stripe_payment_intent_id — these missed the webhook.
  RETURN QUERY
  SELECT
    s.id,
    s.status::TEXT,
    'MANUAL_REVIEW'::TEXT
  FROM public.shipments s -- Fixed: added 'public.' schema prefix
  WHERE s.stripe_payment_intent_id IS NULL
    AND s.status = 'paid'
    AND s.created_at < NOW() - INTERVAL '1 hour'
    AND s.created_at > '2026-06-01'::TIMESTAMPTZ -- Only Connect-era shipments
  LIMIT 100;
END;
$$;


ALTER FUNCTION "public"."fn_reconcile_connect_payments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_reconcile_shipment_label"("p_shipment_id" "uuid", "p_actor_id" "uuid", "p_envia_shipment_id" "text", "p_tracking_number" "text", "p_label_url" "text", "p_carrier" "text", "p_service" "text", "p_print_format" "text", "p_print_size" "text", "p_provider_cost_cents" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_role TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT role INTO v_role FROM public.profiles_private WHERE id = p_actor_id;
  IF v_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY'; END IF;
  IF p_envia_shipment_id IS NULL OR btrim(p_envia_shipment_id) = '' OR p_tracking_number IS NULL OR btrim(p_tracking_number) = '' OR p_label_url IS NULL OR btrim(p_label_url) = '' OR p_print_format IS NULL OR btrim(p_print_format) = '' OR p_print_size IS NULL OR btrim(p_print_size) = '' OR p_provider_cost_cents IS NULL OR p_provider_cost_cents < 0 OR lower(btrim(COALESCE(p_carrier, ''))) <> 'paquetexpress' OR lower(regexp_replace(btrim(COALESCE(p_service, '')), '\s+', ' ', 'g')) <> 'ground' THEN RAISE EXCEPTION 'INVALID_PROVIDER_RESULT'; END IF;
  UPDATE public.shipments
  SET envia_shipment_id = p_envia_shipment_id,
      tracking_number = p_tracking_number,
      label_url = p_label_url,
      carrier = p_carrier,
      service = p_service,
      print_format = p_print_format,
      print_size = p_print_size,
      label_provider_cost_cents = p_provider_cost_cents,
      label_generation_state = 'generated',
      status = 'preparing',
      label_generated_at = now(),
      claim_token = NULL,
      claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_shipment_id AND status = 'paid' AND label_generation_state = 'orphan_pending';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.shipment_label_events (shipment_id, event_type, actor_id)
  VALUES (p_shipment_id, 'reconciled', p_actor_id);
  RETURN true;
END; $$;


ALTER FUNCTION "public"."fn_reconcile_shipment_label"("p_shipment_id" "uuid", "p_actor_id" "uuid", "p_envia_shipment_id" "text", "p_tracking_number" "text", "p_label_url" "text", "p_carrier" "text", "p_service" "text", "p_print_format" "text", "p_print_size" "text", "p_provider_cost_cents" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_record_connect_account_event"("p_stripe_event_id" "text", "p_stripe_account_id" "text", "p_event_type" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean DEFAULT NULL::boolean, "p_external_account_status" "text" DEFAULT NULL::"text", "p_external_account_id" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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

  INSERT INTO public.connect_account_events (
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
  FROM public.connect_account_events cae
  WHERE cae.stripe_event_id = p_stripe_event_id;
  IF v_account_id IS DISTINCT FROM p_stripe_account_id THEN
    RAISE EXCEPTION 'ACCOUNT_EVENT_IDENTITY_MISMATCH';
  END IF;
  RETURN FALSE;
END;
$_$;


ALTER FUNCTION "public"."fn_record_connect_account_event"("p_stripe_event_id" "text", "p_stripe_account_id" "text", "p_event_type" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean, "p_external_account_status" "text", "p_external_account_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_record_tracking_event"("p_shipment_id" "uuid", "p_dispute_id" "uuid", "p_event_type" "public"."shipment_tracking_event_type", "p_event_at" timestamp with time zone, "p_raw_status" "text", "p_location" "text", "p_status_description" "text", "p_carrier_name" "text", "p_webhook_delivery_id" "uuid", "p_polling_run_id" "uuid", "p_transition" "public"."order_status_enum") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_status public.order_status_enum;
  v_event_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT status INTO v_status FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_FOUND';
  END IF;

  INSERT INTO public.shipment_tracking_events (
    shipment_id,
    dispute_id,
    event_type,
    event_at,
    raw_status,
    location,
    status_description,
    carrier_name,
    webhook_delivery_id,
    polling_run_id
  ) VALUES (
    p_shipment_id,
    p_dispute_id,
    p_event_type,
    p_event_at,
    p_raw_status,
    p_location,
    p_status_description,
    p_carrier_name,
    p_webhook_delivery_id,
    p_polling_run_id
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'shipment_status', v_status);
  END IF;

  IF p_dispute_id IS NULL AND v_status = 'preparing' AND p_transition = 'shipped' THEN
    UPDATE public.shipments
    SET status = 'shipped', shipped_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'shipped';
  ELSIF p_dispute_id IS NULL AND v_status = 'shipped' AND p_transition = 'delivered' THEN
    UPDATE public.shipments
    SET status = 'delivered', delivered_at = p_event_at, updated_at = now()
    WHERE id = p_shipment_id;
    v_status := 'delivered';
  ELSIF v_status = 'cancelled' THEN
    NULL;
  END IF;

  RETURN jsonb_build_object('inserted', true, 'event_id', v_event_id, 'shipment_status', v_status);
END;
$$;


ALTER FUNCTION "public"."fn_record_tracking_event"("p_shipment_id" "uuid", "p_dispute_id" "uuid", "p_event_type" "public"."shipment_tracking_event_type", "p_event_at" timestamp with time zone, "p_raw_status" "text", "p_location" "text", "p_status_description" "text", "p_carrier_name" "text", "p_webhook_delivery_id" "uuid", "p_polling_run_id" "uuid", "p_transition" "public"."order_status_enum") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_refresh_seller_stats"("p_seller_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_avg_rating NUMERIC;
    v_rev_count INTEGER;
    v_sales_count INTEGER;
BEGIN
    -- 1. Cálculo de reseñas en un solo escaneo
    SELECT 
        COALESCE(ROUND(AVG(rating)::numeric, 1), 0.0),
        COUNT(*)
    INTO v_avg_rating, v_rev_count
    FROM public.reviews
    WHERE seller_id = p_seller_id;

    -- 2. Cálculo de ventas completadas
    SELECT COUNT(DISTINCT o.id)
    INTO v_sales_count
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE oi.seller_id = p_seller_id
    AND o.status = 'completed';

    -- 3. Actualización atómica en el perfil
    UPDATE public.profiles
    SET
        average_rating = v_avg_rating,
        total_reviews = v_rev_count,
        total_sales = v_sales_count
    WHERE id = p_seller_id;

EXCEPTION WHEN OTHERS THEN
    -- Registro en la Caja Negra (Metadata JSONB)
    INSERT INTO public.system_logs (level, message, metadata) 
    VALUES ('ERROR', 'Fallo en recálculo de reputación', 
            jsonb_build_object('seller_id', p_seller_id, 'error', SQLERRM));
END;
$$;


ALTER FUNCTION "public"."fn_refresh_seller_stats"("p_seller_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_release_payout_claim"("p_run_id" "uuid", "p_claim_token" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_released BOOLEAN;
BEGIN
  UPDATE public.connect_payout_runs
  SET payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
  WHERE id = p_run_id
    AND payout_claim_token = p_claim_token
  RETURNING TRUE INTO v_released;

  RETURN COALESCE(v_released, FALSE);
END;
$$;


ALTER FUNCTION "public"."fn_release_payout_claim"("p_run_id" "uuid", "p_claim_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_release_payout_claim"("p_run_id" "uuid", "p_claim_token" "text") IS 'Releases the executor claim on a claimed run only when the claim token matches, so a stale worker cannot clear a lease a newer worker already holds. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_release_products"("p_product_ids" "uuid"[]) RETURNS TABLE("success" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_auth_user_id UUID;
BEGIN
  -- 1. SEGURIDAD REFORZADA: Exigimos sesión autenticada obligatoria
  v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
  END IF;

  -- 2. OPERACIÓN SEGURA: Solo devuelve a la venta lo que esté temporalmente en RESERVED
  UPDATE public.products
  SET status = 'VERIFIED',
      updated_at = now(),
      reserved_at = NULL
  WHERE id = ANY(p_product_ids)
    AND status = 'RESERVED';

  RETURN QUERY SELECT true;
END;
$$;


ALTER FUNCTION "public"."fn_release_products"("p_product_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_release_shipment_funds"("p_shipment_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$-- =========================================================================
DECLARE
  v_order_id UUID;
  v_seller_id UUID;
  v_status public.order_status_enum;
  v_delivered_at TIMESTAMPTZ;
  v_wallet_id UUID;
  v_wallet_balance NUMERIC;
  v_net_payout NUMERIC;
BEGIN
  -- 1. Bloquear shipment
  SELECT order_id, seller_id, status, delivered_at
    INTO v_order_id, v_seller_id, v_status, v_delivered_at
  FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- Connect guard: if shipment was paid via Stripe Connect, skip wallet release.
  -- Stripe Connect handles fund routing and automatic payouts. Wallet operations
  -- only apply to legacy (pre-Connect) orders.
  IF EXISTS (
    SELECT 1 FROM public.shipments
    WHERE id = p_shipment_id AND stripe_payment_intent_id IS NOT NULL
  ) THEN
    -- Mark shipment as completed without touching wallets
    UPDATE public.shipments SET status = 'completed' WHERE id = p_shipment_id;
    RETURN QUERY SELECT true, 'CONNECT_SHIPMENT_SKIPPED_WALLET'::TEXT; RETURN;
  END IF;

  -- 2. Solo shipments entregados
  IF v_status != 'delivered' THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_DELIVERED'::TEXT; RETURN;
  END IF;

  -- 3. Ignorar si hay disputa activa
  IF EXISTS (
    SELECT 1 FROM public.disputes
    WHERE shipment_id = p_shipment_id AND status NOT IN ('resolved', 'rejected')
  ) THEN
    RETURN QUERY SELECT false, 'SHIPMENT_IN_ACTIVE_DISPUTE'::TEXT; RETURN;
  END IF;

  -- 4. Tiempo de gracia 48h
  IF v_delivered_at > (now() - interval '48 hours') THEN
    RETURN QUERY SELECT false, 'GRACE_PERIOD_ACTIVE'::TEXT; RETURN;
  END IF;

  -- 5. Calcular net_payout de este shipment (COALESCE por defensa ante NULL)
  SELECT COALESCE(SUM(net_payout), 0) INTO v_net_payout
  FROM public.order_items
  WHERE shipment_id = p_shipment_id;

  -- 6. Validar wallet del seller
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_seller_id) THEN
    RETURN QUERY SELECT false, format('SELLER_WALLET_NOT_FOUND: %s', v_seller_id); RETURN;
  END IF;

  -- 7. Liberar fondos
  SELECT id, available_balance INTO v_wallet_id, v_wallet_balance
  FROM public.wallets WHERE user_id = v_seller_id FOR UPDATE;

  UPDATE public.wallets
  SET pending_balance = GREATEST(0, pending_balance - v_net_payout),
      available_balance = available_balance + v_net_payout,
      updated_at = now()
  WHERE id = v_wallet_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'WALLET_UPDATE_FAILED'::TEXT; RETURN;
  END IF;

  INSERT INTO public.wallet_transactions
    (wallet_id, order_id, shipment_id, amount, net_amount, balance_after, type, description)
  VALUES (
    v_wallet_id, v_order_id, p_shipment_id, v_net_payout, v_net_payout,
    v_wallet_balance + v_net_payout, 'release',
    'Liberación automática post-entrega (48h) — Shipment ' || p_shipment_id
  );

  -- 8. Marcar completado (trigger actualiza la orden)
  UPDATE public.shipments
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_release_shipment_funds',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;$$;


ALTER FUNCTION "public"."fn_release_shipment_funds"("p_shipment_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_release_shipment_funds"("p_shipment_id" "uuid") IS 'DEPRECATED by Stripe Connect migration. Stripe Connect handles automatic payouts. Remove in cleanup phase.';



CREATE OR REPLACE FUNCTION "public"."fn_release_stale_reservations"("p_product_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS TABLE("released_id" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE public.products
  SET status = 'VERIFIED',
      updated_at = now(),
      reserved_at = NULL
  WHERE status = 'RESERVED'
    AND reserved_at < now() - interval '10 minutes'
    AND (p_product_ids = '{}' OR id = ANY(p_product_ids))
  RETURNING id;
END;
$$;


ALTER FUNCTION "public"."fn_release_stale_reservations"("p_product_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_release_track_shipments_lease"("p_lane" "text", "p_lease_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_released BOOLEAN := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_lane NOT IN ('preparing', 'shipped') THEN
    RAISE EXCEPTION 'INVALID_TRACKING_LANE';
  END IF;

  IF p_lane = 'preparing' THEN
    UPDATE public.system_settings AS settings
    SET
      track_shipments_preparing_lease_id = NULL,
      track_shipments_preparing_lease_expires_at = NULL
    WHERE id = 1
      AND settings.track_shipments_preparing_lease_id = p_lease_id
    RETURNING true INTO v_released;
  ELSE
    UPDATE public.system_settings AS settings
    SET
      track_shipments_shipped_lease_id = NULL,
      track_shipments_shipped_lease_expires_at = NULL
    WHERE id = 1
      AND settings.track_shipments_shipped_lease_id = p_lease_id
    RETURNING true INTO v_released;
  END IF;

  RETURN COALESCE(v_released, false);
END;
$$;


ALTER FUNCTION "public"."fn_release_track_shipments_lease"("p_lane" "text", "p_lease_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_request_payout"("p_amount" numeric, "p_bank_account_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."fn_request_payout"("p_amount" numeric, "p_bank_account_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_request_payout"("p_amount" numeric, "p_bank_account_id" "uuid") IS 'DEPRECATED by Stripe Connect migration. Sellers withdraw via Stripe Express dashboard. Remove in cleanup phase.';



CREATE OR REPLACE FUNCTION "public"."fn_reserve_products"("p_buyer_id" "uuid", "p_product_ids" "uuid"[]) RETURNS TABLE("total_price" numeric, "success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_reserve_products"("p_buyer_id" "uuid", "p_product_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_resolve_dispute_to_buyer"("p_dispute_id" "uuid", "p_admin_note" "text") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_status public.dispute_status;
    v_buyer_id UUID;
    v_seller_id UUID;
    v_audit_id UUID;
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

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila para evitar doble resolución
    SELECT order_id, status, buyer_id, seller_id
    INTO v_order_id, v_status, v_buyer_id, v_seller_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    IF v_status NOT IN ('open', 'under_review') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- D. EJECUCIÓN: Mover a fase de retorno
    UPDATE public.disputes
    SET status = 'waiting_return',
        resolution_type = 'buyer',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- E. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_APPROVE_RETURN', p_dispute_id, jsonb_build_object('note', p_admin_note, 'order_id', v_order_id))
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
        (v_buyer_id, 'buyer', 'success', 'Devolución aprobada', 'Tu devolución fue aprobada. Consulta el pedido para conocer los próximos pasos y la guía de retorno.'),
        (v_seller_id, 'seller', 'warning', 'Veredicto: Generar Guía', 'Se aprobó la devolución. Consulta el pedido para generar la guía de retorno y continuar el proceso.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'buyer' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_buyer', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;


ALTER FUNCTION "public"."fn_resolve_dispute_to_buyer"("p_dispute_id" "uuid", "p_admin_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_resolve_dispute_to_buyer_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_order_id UUID;
    v_status public.dispute_status;
    v_buyer_id UUID;
    v_seller_id UUID;
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

    -- C. BLOQUEO Y ESTADO: Bloqueamos la fila para evitar doble resolución
    SELECT order_id, status, buyer_id, seller_id
    INTO v_order_id, v_status, v_buyer_id, v_seller_id
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
    END IF;

    IF v_status NOT IN ('open', 'under_review') THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
    END IF;

    -- D. EJECUCIÓN: Mover a fase de retorno
    UPDATE public.disputes
    SET status = 'waiting_return',
        resolution_type = 'buyer',
        admin_notes = COALESCE(admin_notes, '') || E'\n[ADMIN]: ' || p_admin_note,
        resolved_by = v_auth_user_id,
        updated_at = now()
    WHERE id = p_dispute_id;

    -- E. AUDITORÍA: Rastro del Admin
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (v_auth_user_id, 'DISPUTE_APPROVE_RETURN', p_dispute_id, jsonb_build_object('note', p_admin_note, 'order_id', v_order_id))
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
        (v_buyer_id, 'buyer', 'success', 'Devolución aprobada', 'Tu devolución fue aprobada. Consulta el pedido para conocer los próximos pasos y la guía de retorno.'),
        (v_seller_id, 'seller', 'warning', 'Disputa resuelta a favor del comprador', 'El equipo de Selene resolvió la disputa a favor del comprador. Sigue las instrucciones del pedido en la app para coordinar la devolución de tu producto.')
    ) AS recipients(user_id, recipient_role, type, title, message)
    WHERE true AND (recipients.recipient_role = 'buyer' OR v_seller_id IS DISTINCT FROM v_buyer_id)
    ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    -- Registro de error crítico
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_resolve_dispute_to_buyer', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));

    RETURN QUERY SELECT false, 'INTERNAL_SERVER_ERROR'::TEXT;
END;
$$;


ALTER FUNCTION "public"."fn_resolve_dispute_to_buyer_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_resolve_dispute_to_seller"("p_dispute_id" "uuid", "p_admin_note" "text") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."fn_resolve_dispute_to_seller"("p_dispute_id" "uuid", "p_admin_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_resolve_dispute_to_seller_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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
        (v_seller_id, 'seller', 'success', 'Disputa resuelta a tu favor', 'El equipo de Selene resolvió la disputa a tu favor. Una vez liberado el pago, el depósito puede tardar 1–4 días hábiles, dependiendo de tu banco. Consulta el estado del pago en tu pedido.'),
        (v_buyer_id, 'buyer', 'warning', 'Disputa resuelta a favor del vendedor', 'El equipo de Selene resolvió la disputa a favor del vendedor. No se aprobó un reembolso para esta disputa. Consulta los detalles en tu pedido.')
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


ALTER FUNCTION "public"."fn_resolve_dispute_to_seller_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_resolve_product_verdict"("p_product_id" "uuid", "p_verdict" "text", "p_public_note" "text" DEFAULT NULL::"text", "p_private_note" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_auth_user_id UUID;
  v_locked_by UUID;
  v_lock_time TIMESTAMPTZ;
  v_seller_id UUID;
  v_product_name TEXT;
  v_status public.product_status_enum;
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

  IF (p_verdict = 'APPROVE' AND v_status = 'VERIFIED')
     OR (p_verdict = 'REJECT' AND v_status = 'REJECTED') THEN
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
    SET status = 'REJECTED'::public.product_status_enum,
        rejection_reason = trim(p_public_note),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = now()
    WHERE id = p_product_id;
  ELSIF p_verdict = 'APPROVE' THEN
    UPDATE public.products
    SET status = 'VERIFIED'::public.product_status_enum,
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
$$;


ALTER FUNCTION "public"."fn_resolve_product_verdict"("p_product_id" "uuid", "p_verdict" "text", "p_public_note" "text", "p_private_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_save_bank_account"("p_clabe" "text", "p_holder_name" "text") RETURNS TABLE("success" boolean, "bank_name" "text", "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_bank_code TEXT;
    v_bank_name TEXT;
    v_weights INTEGER[] := ARRAY[3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
    v_sum INTEGER := 0;
    v_digit INTEGER;
    v_checksum INTEGER;
    v_last_digit INTEGER;
BEGIN
    -- 1. Seguridad JWT
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::TEXT, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;

    -- 2. Limpieza y Longitud
    p_clabe := regexp_replace(p_clabe, '\D', '', 'g');
    IF length(p_clabe) != 18 THEN
        RETURN QUERY SELECT false, NULL::TEXT, 'CLABE_INVALID_LENGTH'::TEXT; RETURN;
    END IF;

    -- 3. Identificar Banco
    v_bank_code := substr(p_clabe, 1, 3);
    SELECT name INTO v_bank_name FROM public.mexico_banks WHERE code = v_bank_code;
    IF v_bank_name IS NULL THEN v_bank_name := 'OTRO BANCO'; END IF;

    -- 4. Algoritmo Modulo 10 (Validación Matemática)
    FOR i IN 1..17 LOOP
        v_digit := cast(substr(p_clabe, i, 1) as integer);
        v_sum := (v_sum + (v_digit * v_weights[i])) % 10;
    END LOOP;

    v_checksum := (10 - v_sum) % 10;
    v_last_digit := cast(substr(p_clabe, 18, 1) as integer);

    IF v_checksum != v_last_digit THEN
        RETURN QUERY SELECT false, v_bank_name, 'CLABE_CHECKSUM_FAILED'::TEXT; RETURN;
    END IF;

    -- 5. Guardado Atómico (Upsert)
    INSERT INTO public.seller_bank_accounts (
        user_id, clabe, account_holder_name, bank_name, is_verified
    ) VALUES (
        v_auth_user_id, p_clabe, p_holder_name, v_bank_name, true -- SE AUTORIZA AUTOMÁTICAMENTE
    )
    ON CONFLICT (user_id) DO UPDATE SET
        clabe = EXCLUDED.clabe,
        account_holder_name = EXCLUDED.account_holder_name,
        bank_name = EXCLUDED.bank_name,
        is_verified = true,
        created_at = now();

    RETURN QUERY SELECT true, v_bank_name, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, NULL::TEXT, SQLERRM;
END;
$$;


ALTER FUNCTION "public"."fn_save_bank_account"("p_clabe" "text", "p_holder_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_seller_confirm_return_shipment"("p_shipment_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$-- =========================================================================

DECLARE
  v_seller_id UUID;
  v_order_id UUID;
  v_dispute_id UUID;
  v_dispute_status public.dispute_status;
BEGIN
  -- 1. Validar shipment
  SELECT s.seller_id, s.order_id INTO v_seller_id, v_order_id
  FROM public.shipments s WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SHIPMENT_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Obtener dispute activo de este shipment
  SELECT id, status INTO v_dispute_id, v_dispute_status
  FROM public.disputes
  WHERE shipment_id = p_shipment_id AND seller_id = v_seller_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_dispute_id IS NULL THEN
    RETURN QUERY SELECT false, 'NO_ACTIVE_DISPUTE'::TEXT; RETURN;
  END IF;

  -- 3. Autorización: seller del shipment o admin con override
  IF v_seller_id IS DISTINCT FROM auth.uid() AND NOT is_admin() THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 4. Validar status de la disputa
  IF v_dispute_status NOT IN ('return_delivered', 'waiting_return') THEN
    RETURN QUERY SELECT false, 'INVALID_DISPUTE_STATUS'::TEXT; RETURN;
  END IF;

  -- 5. Actualizar disputa
  UPDATE public.disputes
  SET status = 'resolved',
      resolution_type = 'buyer',
      return_delivered_at = COALESCE(return_delivered_at, now()),
      admin_notes = COALESCE(admin_notes, '') || CASE WHEN is_admin() THEN E'\n[SYSTEM]: Administrador forzó confirmación de retorno.' ELSE E'\n[SYSTEM]: Vendedor confirmó recepción manual.' END,
      updated_at = now()
  WHERE id = v_dispute_id;

  -- 6. Auditoría (solo admins, seller no contamina la bitácora administrativa)
  IF is_admin() THEN
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (auth.uid(), 'ADMIN_FORCED_RETURN_CONFIRMATION', v_dispute_id, jsonb_build_object('order_id', v_order_id, 'shipment_id', p_shipment_id));
  END IF;

  -- 7. Gatillar refund del shipment
  RETURN QUERY SELECT * FROM public.fn_complete_shipment_refund(p_shipment_id);

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_seller_confirm_return_shipment',
          jsonb_build_object('shipment_id', p_shipment_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;$$;


ALTER FUNCTION "public"."fn_seller_confirm_return_shipment"("p_shipment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_seller_initiate_return_label"("p_dispute_id" "uuid", "p_caller_id" "uuid") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_seller_id   UUID;
  v_status      TEXT;
  v_shipment_id UUID;
BEGIN
  -- 1. Validar dispute existe
  SELECT d.seller_id, d.status::TEXT, d.shipment_id
  INTO v_seller_id, v_status, v_shipment_id
  FROM public.disputes d WHERE d.id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN;
  END IF;

  -- 2. Validar caller es el seller legítimo de la disputa
  IF v_seller_id IS DISTINCT FROM p_caller_id THEN
    RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
  END IF;

  -- 3. Validar dispute en estado correcto (Esperando guía de retorno)
  IF v_status IS DISTINCT FROM 'waiting_return' THEN
    RETURN QUERY SELECT false,
      format('INVALID_DISPUTE_STATUS: %s', v_status)::TEXT;
    RETURN;
  END IF;

  -- 4. Auditoría (idempotente — siempre loguea de forma informativa)
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('INFO', 'Return label initiated by seller',
    jsonb_build_object(
      'dispute_id', p_dispute_id,
      'shipment_id', v_shipment_id,
      'seller_id', v_seller_id
    ));

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  -- FIX: Inyectamos el insert de telemetría para mantener consistencia absoluta
  -- con todo el sistema de diagnóstico de errores del proyecto.
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_seller_initiate_return_label',
          jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;


ALTER FUNCTION "public"."fn_seller_initiate_return_label"("p_dispute_id" "uuid", "p_caller_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_seller_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[], "p_video_url" "text" DEFAULT NULL::"text") RETURNS TABLE("success" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$

DECLARE
    v_seller_id UUID;
    v_buyer_id UUID;
    v_shipment_id UUID;
    v_auth_user_id UUID;
    v_status public.dispute_status;
    v_order_id UUID;
    v_occurrence_id TEXT;
BEGIN
    v_auth_user_id := NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::UUID;
    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;

    SELECT d.seller_id, d.buyer_id, d.shipment_id, d.status, d.order_id
    INTO v_seller_id, v_buyer_id, v_shipment_id, v_status, v_order_id
    FROM public.disputes d WHERE d.id = p_dispute_id FOR UPDATE;

    IF NOT FOUND THEN RETURN QUERY SELECT false, 'DISPUTE_NOT_FOUND'::TEXT; RETURN; END IF;
    IF v_seller_id IS DISTINCT FROM v_auth_user_id THEN
        RETURN QUERY SELECT false, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;
    IF v_status IS DISTINCT FROM 'return_delivered' THEN
        RETURN QUERY SELECT false, 'INVALID_STATUS_FOR_EVIDENCE'::TEXT; RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(p_images) AS evidence_url(url) WHERE NULLIF(btrim(evidence_url.url), '') IS NOT NULL)
       OR NULLIF(btrim(p_video_url), '') IS NULL THEN
        RETURN QUERY SELECT false, 'EVIDENCE_REQUIRED'::TEXT; RETURN;
    END IF;
    IF v_buyer_id IS NULL OR v_order_id IS NULL OR v_shipment_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.orders o
        JOIN public.shipments s ON s.order_id = o.id
        WHERE o.id = v_order_id AND s.id = v_shipment_id
          AND o.buyer_id = v_buyer_id AND s.seller_id = v_seller_id
    ) THEN
        RETURN QUERY SELECT false, 'INVALID_DISPUTE_RELATIONSHIP'::TEXT; RETURN;
    END IF;

    UPDATE public.disputes
    SET seller_evidence = jsonb_build_object(
            'images', p_images,
            'video_url', p_video_url,
            'submitted_at', now(),
            'notification_event_id', gen_random_uuid()
        ),
        status = 'open',
        admin_notes = COALESCE(admin_notes, '') || E'\n[SYSTEM]: Vendedor ha impugnado el retorno y subido evidencia de video.',
        updated_at = now()
    WHERE id = p_dispute_id
    RETURNING seller_evidence->>'notification_event_id' INTO v_occurrence_id;

    IF v_occurrence_id IS NULL THEN
        RAISE EXCEPTION 'Missing seller evidence occurrence';
    END IF;

    IF v_buyer_id IS DISTINCT FROM v_auth_user_id THEN
        INSERT INTO public.notifications (
            user_id, type, title, message, action_path,
            event_kind, source_event_key, event_payload
        ) VALUES (
            v_buyer_id, 'info', 'Tu disputa se reabrió para revisión',
            'El vendedor reportó un problema con el producto devuelto y presentó evidencia. La misma disputa se reabrió para revisar esa evidencia. Consulta los detalles del caso en tu pedido.',
            '/profile/orders/' || v_order_id::text,
            'return.seller_evidence_submitted',
            'return.seller_evidence_submitted:' || p_dispute_id::text || ':' || v_occurrence_id,
            jsonb_build_object('dispute_id', p_dispute_id, 'order_id', v_order_id,
                               'recipient_role', 'buyer')
        )
        ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
    END IF;

    RETURN QUERY SELECT true, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_seller_submit_return_evidence',
            jsonb_build_object('dispute_id', p_dispute_id, 'error', SQLERRM));
    RETURN QUERY SELECT false, 'EVIDENCE_SUBMISSION_FAILED'::TEXT;
END;
$$;


ALTER FUNCTION "public"."fn_seller_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[], "p_video_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_checkout_recovery_charge_evidence"("p_stripe_payment_intent_id" "text", "p_stripe_charge_id" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stripe_charge_id TEXT;
BEGIN
  IF NULLIF(p_stripe_charge_id, '') IS NULL THEN
    RAISE EXCEPTION 'STRIPE_CHARGE_ID_REQUIRED';
  END IF;

  UPDATE public.orders
  SET stripe_charge_id = COALESCE(stripe_charge_id, p_stripe_charge_id),
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status <> 'refunded'
  RETURNING stripe_charge_id INTO v_stripe_charge_id;

  IF FOUND THEN
    RETURN v_stripe_charge_id;
  END IF;

  UPDATE public.checkout_recovery_shells
  SET stripe_charge_id = COALESCE(stripe_charge_id, p_stripe_charge_id),
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND compensation_state <> 'refunded'
  RETURNING stripe_charge_id INTO v_stripe_charge_id;

  IF FOUND THEN
    RETURN v_stripe_charge_id;
  END IF;

  RAISE EXCEPTION 'CHECKOUT_RECOVERY_TARGET_NOT_FOUND';
END;
$$;


ALTER FUNCTION "public"."fn_set_checkout_recovery_charge_evidence"("p_stripe_payment_intent_id" "text", "p_stripe_charge_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_product_in_dispute"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
  SET status = 'IN_DISPUTE'::public.product_status_enum,
      updated_at = now()
  WHERE id = v_product_id
    AND deleted_at IS NULL
    AND status NOT IN ('SOLD'::public.product_status_enum, 'RESERVED'::public.product_status_enum);

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_set_product_in_dispute"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_shipments_status_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Actualiza el estado de la orden global reactivamente tras cada cambio en shipments
  UPDATE public.orders
  SET status = public.fn_derive_order_status(NEW.order_id),
      updated_at = now()
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_shipments_status_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_start_shipment_cancellation"("p_shipment_id" "uuid", "p_claim_token" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_shipment public.shipments%ROWTYPE;
  v_operation public.shipment_cancellation_operations%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;
  SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;
  SELECT * INTO v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR p_claim_token IS NULL OR v_operation.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'STALE_CANCELLATION_CLAIM';
  END IF;
  IF v_operation.external_started_at IS NOT NULL THEN RAISE EXCEPTION 'CANCELLATION_EXTERNAL_ALREADY_STARTED'; END IF;
  IF v_operation.claim_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_CLAIM_EXPIRED'; END IF;
  IF v_operation.order_id IS DISTINCT FROM v_shipment.order_id THEN RAISE EXCEPTION 'SHIPMENT_ORDER_MISMATCH'; END IF;
  IF (v_operation.source IN ('buyer', 'seller', 'paid_timeout') AND v_shipment.status IS DISTINCT FROM 'paid')
     OR (v_operation.source = 'preparing_timeout' AND v_shipment.status IS DISTINCT FROM 'preparing') THEN
    RAISE EXCEPTION 'SHIPMENT_NOT_CANCELABLE';
  END IF;
  IF v_shipment.stripe_transfer_id IS NOT NULL OR v_shipment.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'SHIPMENT_FUNDS_ALREADY_RELEASED';
  END IF;
  IF v_shipment.label_generation_state IN ('claimed', 'generation_sent', 'orphan_pending')
     OR (v_shipment.status = 'paid' AND v_shipment.label_generation_state = 'generated') THEN
    RAISE EXCEPTION 'SHIPMENT_LABEL_OPERATION_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.connect_payout_run_shipments
    WHERE shipment_id = p_shipment_id AND transfer_started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_TRANSFER_OPERATION_ACTIVE';
  END IF;

  UPDATE public.shipment_cancellation_operations SET external_started_at = clock_timestamp()
    WHERE shipment_id = p_shipment_id AND claim_token = p_claim_token;
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."fn_start_shipment_cancellation"("p_shipment_id" "uuid", "p_claim_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_start_shipment_cancellation_refund"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_refund_request" "jsonb", "p_cancellation_loss_cents" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_operation public.shipment_cancellation_operations%ROWTYPE;
  v_payment_intent_id TEXT;
  v_metadata JSONB;
  v_amount NUMERIC;
  v_share NUMERIC;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  -- The definer can call the private original entry point. Any later rejection
  -- rolls this mark back, including malformed payloads or failed persistence.
  PERFORM public.fn_start_shipment_cancellation(p_shipment_id, p_claim_token);
  SELECT * INTO STRICT v_operation FROM public.shipment_cancellation_operations
    WHERE shipment_id = p_shipment_id;
  SELECT COALESCE(s.stripe_payment_intent_id, o.stripe_payment_intent_id)
    INTO v_payment_intent_id
    FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = p_shipment_id;

  IF jsonb_typeof(p_refund_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_refund_request)) <> 4
     OR jsonb_typeof(p_refund_request->'payment_intent') IS DISTINCT FROM 'string'
     OR v_payment_intent_id IS NULL OR btrim(v_payment_intent_id) = ''
     OR p_refund_request->>'payment_intent' IS DISTINCT FROM v_payment_intent_id
     OR p_refund_request->>'reason' IS DISTINCT FROM 'requested_by_customer'
     OR jsonb_typeof(p_refund_request->'amount') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_refund_request->'metadata') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  v_amount := (p_refund_request->>'amount')::numeric;
  IF v_amount <= 0 OR v_amount > 9007199254740991 OR trunc(v_amount) <> v_amount THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;

  v_metadata := p_refund_request->'metadata';
  IF (SELECT count(*) FROM jsonb_object_keys(v_metadata)) <> 5
     OR v_metadata->>'shipment_id' IS DISTINCT FROM p_shipment_id::text
     OR v_metadata->>'order_id' IS DISTINCT FROM v_operation.order_id::text
     OR v_metadata->>'caller_role' IS DISTINCT FROM
       (CASE WHEN v_operation.source IN ('buyer', 'seller') THEN v_operation.source ELSE 'system' END)
     OR jsonb_typeof(v_metadata->'reason') IS DISTINCT FROM 'string'
     OR v_metadata->>'reason' IS DISTINCT FROM v_operation.reason
     OR jsonb_typeof(v_metadata->'seguro_share_cents') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  v_share := (v_metadata->>'seguro_share_cents')::numeric;
  IF v_share < 0 OR v_share > v_amount OR trunc(v_share) <> v_share THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REFUND_REQUEST';
  END IF;
  IF p_cancellation_loss_cents < 0 OR p_cancellation_loss_cents > 9007199254740991 THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_LOSS';
  END IF;

  UPDATE public.shipment_cancellation_operations
    SET refund_request = p_refund_request, cancellation_loss_cents = p_cancellation_loss_cents
    WHERE shipment_id = p_shipment_id
    RETURNING * INTO v_operation;
  RETURN jsonb_build_object('operation_key', v_operation.operation_key,
    'refund_request', v_operation.refund_request,
    'cancellation_loss_cents', v_operation.cancellation_loss_cents);
END;
$$;


ALTER FUNCTION "public"."fn_start_shipment_cancellation_refund"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_refund_request" "jsonb", "p_cancellation_loss_cents" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_transition_payout_release_stage"("p_run_id" "uuid", "p_target_stage" "text", "p_expected_stage_version" integer, "p_claim_token" "text" DEFAULT NULL::"text", "p_last_error" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stage TEXT;
  v_version INTEGER;
  v_token TEXT;
  v_expires TIMESTAMPTZ;
  v_new_version INTEGER;
BEGIN
  IF p_target_stage NOT IN (
    'ready',
    'release_accepted',
    'transfer_created',
    'awaiting_connected_balance',
    'payout_create_in_progress',
    'payout_pending',
    'payout_in_transit',
    'paid_observed',
    'payout_failed',
    'payout_canceled',
    'action_required'
  ) THEN
    RAISE EXCEPTION 'UNSUPPORTED_RELEASE_STAGE';
  END IF;

  IF p_expected_stage_version IS NULL OR p_expected_stage_version < 1 THEN
    RAISE EXCEPTION 'INVALID_STAGE_VERSION';
  END IF;

  SELECT cpr.release_stage, cpr.release_stage_version, cpr.payout_claim_token,
         cpr.payout_claim_expires_at
  INTO v_stage, v_version, v_token, v_expires
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF p_claim_token IS NOT NULL AND (v_token IS NULL OR v_token <> p_claim_token) THEN
    RAISE EXCEPTION 'STALE_CLAIM';
  END IF;

  -- Token-conditional writes also require an unexpired lease: a worker whose
  -- lease lapsed mid-flight lost durable ownership and must not transition
  -- the run; the claim flow (or the manual path, which passes no token)
  -- owns the next decision.
  IF p_claim_token IS NOT NULL AND (v_expires IS NULL OR v_expires <= now()) THEN
    RAISE EXCEPTION 'CLAIM_LEASE_EXPIRED';
  END IF;

  IF v_version <> p_expected_stage_version THEN
    RAISE EXCEPTION 'STAGE_VERSION_CONFLICT';
  END IF;

  IF v_stage IN ('paid_observed', 'payout_failed', 'payout_canceled')
    AND p_target_stage NOT IN ('paid_observed', 'payout_failed', 'payout_canceled') THEN
    RAISE EXCEPTION 'TERMINAL_STAGE_REGRESSION';
  END IF;

  IF v_stage = 'action_required'
    AND p_target_stage NOT IN ('paid_observed', 'payout_failed', 'payout_canceled', 'action_required') THEN
    RAISE EXCEPTION 'STAGE_TRANSITION_BLOCKED';
  END IF;

  v_new_version := v_version + 1;

  UPDATE public.connect_payout_runs
  SET release_stage = p_target_stage,
      release_stage_version = v_new_version,
      last_error = p_last_error,
      payout_claim_token = NULL,
      payout_claim_expires_at = NULL,
      updated_at = now()
    WHERE id = p_run_id;

  RETURN v_new_version;
END;
$$;


ALTER FUNCTION "public"."fn_transition_payout_release_stage"("p_run_id" "uuid", "p_target_stage" "text", "p_expected_stage_version" integer, "p_claim_token" "text", "p_last_error" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_transition_payout_release_stage"("p_run_id" "uuid", "p_target_stage" "text", "p_expected_stage_version" integer, "p_claim_token" "text", "p_last_error" "text") IS 'Guarded stage transition: rejects unknown stages, stale claim tokens, lapsed leases, stale stage versions, and terminal/action_required regressions; bumps the version monotonically and clears the executor claim. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"("p_job_id" "uuid", "p_outcome" "text", "p_next_retry_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_last_error" "text" DEFAULT NULL::"text") RETURNS "public"."stripe_fee_reconciliation_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'STRIPE_FEE_LEASE_REQUIRED' USING ERRCODE = 'P0001';
END;
$$;


ALTER FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"("p_job_id" "uuid", "p_outcome" "text", "p_next_retry_at" timestamp with time zone, "p_last_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job_leased"("p_job_id" "uuid", "p_claim_token" "uuid", "p_outcome" "text", "p_next_retry_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_last_error" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_job public.stripe_fee_reconciliation_jobs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR p_job_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('retry', 'failed')
     OR (p_outcome = 'retry' AND p_next_retry_at IS NULL)
     OR (p_outcome = 'failed' AND p_next_retry_at IS NOT NULL)
     OR p_last_error IS NULL OR btrim(p_last_error) = ''
     OR char_length(p_last_error) > 4000 THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.stripe_fee_reconciliation_jobs
  WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  -- clock_timestamp is evaluated AFTER acquiring the lock, not at transaction start.
  IF v_job.status <> 'processing'
     OR v_job.claim_token IS DISTINCT FROM p_claim_token
     OR v_job.claim_expires_at IS NULL
     OR v_job.claim_expires_at <= clock_timestamp() THEN
    RETURN FALSE;
  END IF;

  UPDATE public.stripe_fee_reconciliation_jobs
  SET status = CASE p_outcome WHEN 'retry' THEN 'pending' ELSE 'failed' END,
      next_retry_at = p_next_retry_at, last_error = p_last_error,
      claim_token = NULL, claim_expires_at = NULL, updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job_leased"("p_job_id" "uuid", "p_claim_token" "uuid", "p_outcome" "text", "p_next_retry_at" timestamp with time zone, "p_last_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_trigger_review_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Llamamos al trabajador que actualizamos en el Paso 1
    PERFORM public.fn_refresh_seller_stats(COALESCE(NEW.seller_id, OLD.seller_id));
    
    RETURN NULL; -- Correcto para triggers AFTER

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en trigger tr_after_review_change',
            jsonb_build_object(
                'operation', TG_OP,
                'seller_id', COALESCE(NEW.seller_id, OLD.seller_id),
                'error', SQLERRM
            ));
    RAISE; -- Forzamos rollback para evitar inconsistencia
END;
$$;


ALTER FUNCTION "public"."fn_trigger_review_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_unlock_dispute"("p_dispute_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_rows_affected INTEGER;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION'; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth_user_id AND role = 'admin') THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    -- FIX APLICADO: Manejo explícito de NULL en el tiempo de bloqueo
    UPDATE public.disputes
    SET locked_by = NULL,
        locked_at = NULL
    WHERE id = p_dispute_id
    AND (
        locked_by = v_auth_user_id
        OR locked_at IS NULL
        OR locked_at < (now() - interval '10 minutes')
    );

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected > 0 THEN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'DISPUTE_UNLOCK', p_dispute_id, jsonb_build_object('timestamp', now()));
        RETURN true;
    END IF;

    RETURN false;

EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.system_logs (level, message, metadata)
    VALUES ('ERROR', 'Fallo en fn_unlock_dispute', jsonb_build_object('dispute_id', p_dispute_id, 'admin_id', v_auth_user_id, 'error', SQLERRM));
    RAISE;
END;
$$;


ALTER FUNCTION "public"."fn_unlock_dispute"("p_dispute_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_unlock_product"("p_product_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_auth_user_id UUID;
    v_is_admin BOOLEAN;
    v_rows_affected INTEGER;
BEGIN
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED_NO_SESSION';
    END IF;

    -- Direct check bypassing is_admin() which may have search_path issues
    SELECT EXISTS (
        SELECT 1 FROM public.profiles_private
        WHERE id = v_auth_user_id AND role = 'admin'
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
    END IF;

    UPDATE public.products
    SET locked_by = NULL, locked_at = NULL
    WHERE id = p_product_id
    AND (locked_by = v_auth_user_id OR locked_at < (now() - interval '10 minutes'));

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected > 0 THEN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
        VALUES (v_auth_user_id, 'PRODUCT_UNLOCK', p_product_id, jsonb_build_object('timestamp', now()));
        RETURN true;
    END IF;

    RETURN false;
END;
$$;


ALTER FUNCTION "public"."fn_unlock_product"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_update_product_fts"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_specs_text TEXT := '';
BEGIN
  -- A. NULL SAFETY: Extraemos valores del JSONB solo si no es nulo
  -- Esto permite buscar por "8GB" o "NVIDIA" aunque estén dentro del JSONB
  IF NEW.specifications IS NOT NULL AND NEW.specifications != '{}'::jsonb THEN
    SELECT string_agg(value, ' ') INTO v_specs_text
    FROM jsonb_each_text(NEW.specifications);
  END IF;

  -- B. CONSTRUCCIÓN DEL ÍNDICE (Diccionario 'simple')
  -- Combinamos Nombre, Categoría, Descripción y Especificaciones
  NEW.fts :=
    to_tsvector('simple', coalesce(NEW.name, '')) ||
    to_tsvector('simple', coalesce(NEW.category, '')) ||
    to_tsvector('simple', coalesce(NEW.description, '')) ||
    to_tsvector('simple', coalesce(v_specs_text, ''));

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Caja Negra: Si el buscador falla, logueamos el error pero no bloqueamos la venta
  INSERT INTO public.system_logs (level, message, metadata)
  VALUES ('ERROR', 'Fallo en fn_update_product_fts', 
          jsonb_build_object('product_id', NEW.id, 'error', SQLERRM));

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_update_product_fts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_upsert_checkout_recovery_shell"("p_stripe_payment_intent_id" "text", "p_reason" "text", "p_source_metadata" "jsonb", "p_charged_amount_cents" bigint, "p_stripe_charge_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id UUID;
  v_refunded_order_id UUID;
  v_order_refund_id TEXT;
  v_shell_payment_intent_id TEXT;
BEGIN
  UPDATE public.orders
  SET payment_processing = true,
      payment_processing_reason = p_reason,
      compensation_state = COALESCE(compensation_state, 'refund_pending'),
      next_compensation_retry_at = COALESCE(next_compensation_retry_at, now() + interval '5 minutes'),
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status <> 'refunded'
  RETURNING id INTO v_order_id;

  IF v_order_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id', v_order_id,
      'target', 'order',
      'runtime_version', 'paid_checkout_recovery_v1'
    );
  END IF;

  SELECT id, stripe_refund_id
  INTO v_refunded_order_id, v_order_refund_id
  FROM public.orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND status = 'refunded'
  FOR UPDATE;

  IF v_refunded_order_id IS NOT NULL THEN
    UPDATE public.checkout_recovery_shells
    SET compensation_state = 'refunded',
        stripe_refund_id = COALESCE(stripe_refund_id, v_order_refund_id),
        compensation_lease_expires_at = NULL,
        next_compensation_retry_at = NULL,
        updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
      AND compensation_state <> 'refunded';

    RETURN jsonb_build_object(
      'status', 'duplicate',
      'order_id', v_refunded_order_id,
      'runtime_version', 'paid_checkout_recovery_v1'
    );
  END IF;

  INSERT INTO public.checkout_recovery_shells (
    stripe_payment_intent_id,
    reason,
    source_metadata,
    charged_amount_cents,
    stripe_charge_id,
    next_compensation_retry_at
  ) VALUES (
    p_stripe_payment_intent_id,
    p_reason,
    COALESCE(p_source_metadata, '{}'::JSONB),
    p_charged_amount_cents,
    p_stripe_charge_id,
    now()
  )
  ON CONFLICT (stripe_payment_intent_id) DO UPDATE
  SET reason = EXCLUDED.reason,
      source_metadata = EXCLUDED.source_metadata,
      charged_amount_cents = COALESCE(
        public.checkout_recovery_shells.charged_amount_cents,
        EXCLUDED.charged_amount_cents
      ),
      -- Charge evidence is immutable once observed; retries cannot replace it.
      stripe_charge_id = COALESCE(public.checkout_recovery_shells.stripe_charge_id, EXCLUDED.stripe_charge_id),
      updated_at = now()
  WHERE public.checkout_recovery_shells.compensation_state <> 'refunded'
  RETURNING stripe_payment_intent_id INTO v_shell_payment_intent_id;

  IF v_shell_payment_intent_id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate', 'runtime_version', 'paid_checkout_recovery_v1');
  END IF;

  RETURN jsonb_build_object(
    'stripe_payment_intent_id', v_shell_payment_intent_id,
    'target', 'standalone_recovery_shell',
    'runtime_version', 'paid_checkout_recovery_v1'
  );
END;
$$;


ALTER FUNCTION "public"."fn_upsert_checkout_recovery_shell"("p_stripe_payment_intent_id" "text", "p_reason" "text", "p_source_metadata" "jsonb", "p_charged_amount_cents" bigint, "p_stripe_charge_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_verify_payout_claim"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_token TEXT;
  v_expires TIMESTAMPTZ;
  v_version INTEGER;
BEGIN
  SELECT cpr.payout_claim_token,
         cpr.payout_claim_expires_at,
         cpr.release_stage_version
  INTO v_token, v_expires, v_version
  FROM public.connect_payout_runs cpr
  WHERE cpr.id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_RUN_NOT_FOUND';
  END IF;

  IF p_claim_token IS NULL OR v_token IS NULL OR v_token <> p_claim_token THEN
    RAISE EXCEPTION 'STALE_CLAIM';
  END IF;

  IF v_expires IS NULL OR v_expires <= now() THEN
    RAISE EXCEPTION 'CLAIM_LEASE_EXPIRED';
  END IF;

  IF p_expected_stage_version IS NULL OR v_version <> p_expected_stage_version THEN
    RAISE EXCEPTION 'STAGE_VERSION_CONFLICT';
  END IF;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."fn_verify_payout_claim"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fn_verify_payout_claim"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) IS 'Proves a still-live executor claim before a Stripe call or DB transition: the exact claim token must match, the lease must be unexpired, and the monotonic stage version must equal the expected one; raises STALE_CLAIM, CLAIM_LEASE_EXPIRED, or STAGE_VERSION_CONFLICT otherwise. Read-only. Server-only; execution restricted to service_role.';



CREATE OR REPLACE FUNCTION "public"."get_profile_stats"("target_user_id" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  total_sold integer;
  avg_rating numeric;
  total_reviews integer;
begin
  -- Contar ventas (Productos con status 'SOLD')
  select count(*) into total_sold
  from public.products
  where seller_id = target_user_id and status = 'SOLD';

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
$$;


ALTER FUNCTION "public"."get_profile_stats"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url, email) -- <--- Agregamos email
  VALUES (
    new.id,
    COALESCE(
      new.raw_user_meta_data->>'username',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    new.email -- <--- El email real de Auth
  );
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_sync_user_data"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.profiles 
  SET email = NEW.email,
      last_sign_in_at = NEW.last_sign_in_at
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_sync_user_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_sync_user_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.profiles 
  SET email = NEW.email,
      last_sign_in_at = NEW.last_sign_in_at -- <--- SINCRONIZACIÓN DE LOGIN
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_sync_user_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_update_user_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF (OLD.email IS DISTINCT FROM NEW.email) THEN
    -- Actualizamos el perfil
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
    
    -- Guardamos el rastro en la bitácora que creamos antes
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (
      NULL, 
      'USER_EMAIL_CHANGED', 
      NEW.id, 
      jsonb_build_object('old_email', OLD.email, 'new_email', NEW.email)
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_update_user_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

DECLARE
    v_role TEXT;
    v_status public.account_status;
BEGIN
    SELECT role, status
    INTO v_role, v_status
    FROM public.profiles_private
    WHERE id = auth.uid();

    -- Suspended or banned admins lose admin authority
    RETURN COALESCE(v_role = 'admin' AND COALESCE(v_status, 'active') = 'active', false);
END;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_publication_rate"("p_rate" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN p_rate IS NULL OR p_rate < 0 THEN NULL
    WHEN p_rate <= 1 THEN p_rate
    WHEN p_rate <= 100 THEN p_rate / 100
    ELSE p_rate / 10000
  END;
$$;


ALTER FUNCTION "public"."normalize_publication_rate"("p_rate" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF OLD.origin_address IS NOT NULL AND (
    NEW.origin_address IS DISTINCT FROM OLD.origin_address
    OR NEW.origin_address_id IS DISTINCT FROM OLD.origin_address_id
  ) THEN RAISE EXCEPTION 'ORIGIN_SNAPSHOT_IMMUTABLE'; END IF;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_product_publication_economics"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_shipping_buffer_cents BIGINT;
  v_commission_rate NUMERIC;
  v_insurance_rate NUMERIC;
  v_expected_reserve_cents BIGINT;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.publication_shipping_reserve_cents IS NOT NULL
    AND (
      NEW.publication_shipping_reserve_cents IS DISTINCT FROM OLD.publication_shipping_reserve_cents
      OR NEW.publication_commission_rate IS DISTINCT FROM OLD.publication_commission_rate
      OR NEW.publication_insurance_rate IS DISTINCT FROM OLD.publication_insurance_rate
    ) THEN
    RAISE EXCEPTION 'PUBLICATION_ECONOMICS_IMMUTABLE';
  END IF;

  IF NEW.publication_shipping_reserve_cents IS NULL
    AND NEW.publication_commission_rate IS NULL
    AND NEW.publication_insurance_rate IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'PUBLICATION_SNAPSHOT_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;

  SELECT
    shipping_buffer_cents,
    normalize_publication_rate(service_fee_pct),
    normalize_publication_rate(insurance_rate)
  INTO v_shipping_buffer_cents, v_commission_rate, v_insurance_rate
  FROM public.system_settings
  WHERE id = 1;

  IF v_shipping_buffer_cents IS NULL
    OR v_commission_rate IS NULL
    OR v_insurance_rate IS NULL
    OR NEW.shipping_cost IS NULL THEN
    RAISE EXCEPTION 'PUBLICATION_ECONOMICS_CONFIGURATION_REQUIRED';
  END IF;

  v_expected_reserve_cents :=
    round(NEW.shipping_cost * 100)::BIGINT
    + v_shipping_buffer_cents
    + ceil(round(NEW.price * 100)::NUMERIC * v_insurance_rate)::BIGINT;

  IF NEW.publication_shipping_reserve_cents <> v_expected_reserve_cents
    OR NEW.publication_commission_rate <> v_commission_rate
    OR NEW.publication_insurance_rate <> v_insurance_rate THEN
    RAISE EXCEPTION 'INVALID_OR_STALE_PUBLICATION_ECONOMICS';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_product_publication_economics"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."addresses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "street_line1" "text" NOT NULL,
    "street_line2" "text",
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip_code" "text" NOT NULL,
    "country" "text" DEFAULT 'MX'::"text" NOT NULL,
    "latitude" double precision,
    "longitude" double precision,
    "is_default" boolean DEFAULT false,
    "instructions" "text",
    "label" "text" NOT NULL,
    "district" "text",
    "deleted_at" timestamp with time zone,
    "street_number" "text"
);


ALTER TABLE "public"."addresses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid",
    "action_type" "text" NOT NULL,
    "target_id" "uuid",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "order_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "price_at_purchase" numeric NOT NULL,
    "commission_amount" numeric DEFAULT 0,
    "shipping_amount" numeric DEFAULT 0,
    "insurance_amount" numeric DEFAULT 0,
    "net_payout" numeric DEFAULT 0,
    "shipping_payer" "text" DEFAULT 'seller'::"text",
    "shipment_id" "uuid",
    "sat_tax_withholding" numeric
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."order_items"."commission_amount" IS 'Monto retenido por Selene como comisión de plataforma';



COMMENT ON COLUMN "public"."order_items"."shipping_amount" IS 'Monto descontado al vendedor para cubrir la logística de envío';



COMMENT ON COLUMN "public"."order_items"."net_payout" IS 'Monto final a transferir al vendedor tras todas las deducciones';



COMMENT ON COLUMN "public"."order_items"."sat_tax_withholding" IS 'Monto total de retención SAT (ISR + IVA) para este artículo. Calculado en fn_create_order_from_payment.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "username" "text",
    "avatar_url" "text",
    "is_verified_seller" boolean DEFAULT false,
    "average_rating" numeric(3,1) DEFAULT 0.0 NOT NULL,
    "total_reviews" integer DEFAULT 0 NOT NULL,
    "total_sales" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "username_length" CHECK ((("char_length"("username") >= 3) AND ("char_length"("username") <= 20)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Public profile information for each user.';



COMMENT ON COLUMN "public"."profiles"."id" IS 'References auth.users.id';



CREATE TABLE IF NOT EXISTS "public"."shipments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "status" "public"."order_status_enum" DEFAULT 'paid'::"public"."order_status_enum" NOT NULL,
    "origin_address" "jsonb",
    "tracking_number" "text",
    "label_url" "text",
    "carrier" "text",
    "envia_shipment_id" "text",
    "shipped_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_tracked_at" timestamp with time zone,
    "return_tracking_number" "text",
    "return_label_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "stripe_payment_intent_id" "text",
    "stripe_payout_id" "text",
    "shipping_evidence" "jsonb",
    "shipping_cost" integer DEFAULT 0,
    "stripe_transfer_id" "text",
    "label_generation_state" "text" DEFAULT 'unclaimed'::"text" NOT NULL,
    "claim_token" "uuid",
    "claim_expires_at" timestamp with time zone,
    "service" "text",
    "print_format" "text",
    "print_size" "text",
    "label_provider_cost_cents" bigint,
    "label_generated_at" timestamp with time zone,
    "label_quote_carrier" "text",
    "label_quote_service" "text",
    "label_quote_cost_cents" bigint,
    "label_quote_reference" "text",
    "label_quote_rated_at" timestamp with time zone,
    "label_quote_input_hash" "text",
    "origin_address_id" "uuid",
    "buyer_confirmed_at" timestamp with time zone,
    CONSTRAINT "shipments_label_claim_check" CHECK ((("label_generation_state" = ANY (ARRAY['claimed'::"text", 'generation_sent'::"text", 'orphan_pending'::"text"])) = ("claim_token" IS NOT NULL))),
    CONSTRAINT "shipments_label_generation_state_check" CHECK (("label_generation_state" = ANY (ARRAY['unclaimed'::"text", 'claimed'::"text", 'generation_sent'::"text", 'retryable_rejected'::"text", 'orphan_pending'::"text", 'generated'::"text"]))),
    CONSTRAINT "shipments_label_provider_cost_cents_check" CHECK ((("label_provider_cost_cents" IS NULL) OR ("label_provider_cost_cents" >= 0))),
    CONSTRAINT "shipments_label_quote_cost_cents_check" CHECK ((("label_quote_cost_cents" IS NULL) OR ("label_quote_cost_cents" >= 0)))
);


ALTER TABLE "public"."shipments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shipments"."stripe_payment_intent_id" IS 'Stripe PaymentIntent ID for this shipment (Connect-era). NULL for legacy wallet-era shipments.';



COMMENT ON COLUMN "public"."shipments"."stripe_payout_id" IS 'Stripe Payout ID when the seller''s Connect balance was transferred to their bank. NULL until release-connect-payout processes the completed shipment.';



COMMENT ON COLUMN "public"."shipments"."stripe_transfer_id" IS 'Stripe Transfer ID created by manual admin release moving platform funds to the seller Connect account, grouped under orders.stripe_transfer_group. NULL until release creates it; written exactly once.';



CREATE OR REPLACE VIEW "public"."admin_connect_earnings_view" WITH ("security_invoker"='true') AS
 SELECT "s"."id",
    "s"."seller_id",
    "p"."username" AS "seller_name",
    "s"."stripe_payment_intent_id",
    (COALESCE("round"(((("sum"("oi"."price_at_purchase") + "sum"(COALESCE("oi"."shipping_amount", (0)::numeric))) + "sum"(COALESCE("oi"."insurance_amount", (0)::numeric))) * (100)::numeric)), (0)::numeric))::bigint AS "amount",
    (COALESCE("round"(("sum"(COALESCE("oi"."commission_amount", ("oi"."price_at_purchase" * 0.06))) * (100)::numeric)), (0)::numeric))::bigint AS "application_fee_amount",
        CASE
            WHEN ("s"."status" = 'refunded'::"public"."order_status_enum") THEN 'refunded'::"text"
            WHEN ("s"."status" = 'cancelled'::"public"."order_status_enum") THEN 'failed'::"text"
            ELSE 'succeeded'::"text"
        END AS "status",
    "s"."created_at"
   FROM (("public"."shipments" "s"
     JOIN "public"."profiles" "p" ON (("p"."id" = "s"."seller_id")))
     LEFT JOIN "public"."order_items" "oi" ON (("oi"."shipment_id" = "s"."id")))
  WHERE ("s"."stripe_payment_intent_id" IS NOT NULL)
  GROUP BY "s"."id", "s"."seller_id", "p"."username", "s"."stripe_payment_intent_id", "s"."status", "s"."created_at";


ALTER VIEW "public"."admin_connect_earnings_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connect_payout_run_shipments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "shipment_id" "uuid" NOT NULL,
    "net_payout" integer NOT NULL,
    "status" "text" DEFAULT 'pending_reconciliation'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "transfer_started_at" timestamp with time zone,
    "transfer_token" "uuid",
    CONSTRAINT "connect_payout_run_shipments_net_payout_check" CHECK (("net_payout" >= 0)),
    CONSTRAINT "connect_payout_run_shipments_status_check" CHECK (("status" = ANY (ARRAY['pending_reconciliation'::"text", 'paid'::"text", 'failed'::"text", 'canceled'::"text", 'reconciliation_needed'::"text"]))),
    CONSTRAINT "connect_payout_run_shipments_transfer_start_pair" CHECK ((("transfer_started_at" IS NULL) = ("transfer_token" IS NULL)))
);


ALTER TABLE "public"."connect_payout_run_shipments" OWNER TO "postgres";


COMMENT ON TABLE "public"."connect_payout_run_shipments" IS 'Shipment-to-payout-run mapping for Connect manual release reconciliation.';



COMMENT ON COLUMN "public"."connect_payout_run_shipments"."net_payout" IS 'Shipment payout amount in cents captured at release-run creation time.';



COMMENT ON COLUMN "public"."connect_payout_run_shipments"."transfer_started_at" IS 'Write-ahead possible Stripe Transfer effect. Never cleared by TTL, resume, payout failure or cancellation. An uncertain response requires investigation, never another create.';



COMMENT ON COLUMN "public"."connect_payout_run_shipments"."transfer_token" IS 'Opaque immutable ownership of the shipment Transfer attempt within this existing run mapping; conditional identity completion only, not a reclaimable lease.';



CREATE TABLE IF NOT EXISTS "public"."connect_payout_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "amount" integer NOT NULL,
    "status" "text" DEFAULT 'pending_reconciliation'::"text" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "stripe_payout_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paid_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "failure_reason" "text",
    "retry_of_run_id" "uuid",
    "release_stage" "text",
    "release_stage_version" integer DEFAULT 1 NOT NULL,
    "payout_claim_token" "text",
    "payout_claim_expires_at" timestamp with time zone,
    "payout_create_attempted_at" timestamp with time zone,
    "next_attempt_at" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "action_required_reason" "text",
    CONSTRAINT "connect_payout_runs_amount_check" CHECK (("amount" >= 0)),
    CONSTRAINT "connect_payout_runs_release_stage_check" CHECK (("release_stage" = ANY (ARRAY['ready'::"text", 'release_accepted'::"text", 'transfer_created'::"text", 'awaiting_connected_balance'::"text", 'payout_create_in_progress'::"text", 'payout_pending'::"text", 'payout_in_transit'::"text", 'paid_observed'::"text", 'payout_failed'::"text", 'payout_canceled'::"text", 'action_required'::"text"]))),
    CONSTRAINT "connect_payout_runs_status_check" CHECK (("status" = ANY (ARRAY['pending_reconciliation'::"text", 'paid'::"text", 'failed'::"text", 'canceled'::"text", 'reconciliation_needed'::"text"])))
);


ALTER TABLE "public"."connect_payout_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."connect_payout_runs" IS 'Auditable manual Stripe Connect payout run created by an admin for a seller shipment batch.';



COMMENT ON COLUMN "public"."connect_payout_runs"."idempotency_key" IS 'Client-provided idempotency key used to reuse an existing payout run on retry.';



COMMENT ON COLUMN "public"."connect_payout_runs"."amount" IS 'Total payout amount in cents. Single-modal orders use the checkout-fixed sum of order_items.net_payout; legacy orders retain the shipment shipping_cost deduction.';



COMMENT ON COLUMN "public"."connect_payout_runs"."retry_of_run_id" IS 'Failed payout run retried by this child run. The parent remains immutable audit history.';



COMMENT ON COLUMN "public"."connect_payout_runs"."release_stage" IS 'Selene aggregate release stage (payout operating model). Distinct from Stripe payout state: no Stripe payout exists before payout_pending. payout_create_in_progress is the durable write-ahead fence held while a Stripe payout create is in flight; it is only exited by completing the payout identity, reconciling the Stripe outcome, or an action_required abort — never by a second create.';



COMMENT ON COLUMN "public"."connect_payout_runs"."release_stage_version" IS 'Monotonic stage version; every conditional stage write must carry the version it observed so stale workers conflict instead of overwriting.';



COMMENT ON COLUMN "public"."connect_payout_runs"."payout_claim_token" IS 'Opaque claim token held by the current executor worker; every worker write is token-conditional. NULL = unclaimed.';



COMMENT ON COLUMN "public"."connect_payout_runs"."payout_claim_expires_at" IS 'Expiry of the executor lease. The lease guards worker concurrency and crash recovery only; Stripe idempotency on the persisted idempotency_key remains the duplicate-payout guarantee.';



COMMENT ON COLUMN "public"."connect_payout_runs"."payout_create_attempted_at" IS 'Write-ahead timestamp recorded when the payout_create_in_progress fence is opened, before the Stripe payout create call; it bounds the reconciliation listing window.';



COMMENT ON COLUMN "public"."connect_payout_runs"."next_attempt_at" IS 'Earliest time the awaiting-balance executor may claim this run again after an insufficient-balance deferral; NULL = immediately eligible.';



COMMENT ON COLUMN "public"."connect_payout_runs"."attempt_count" IS 'Number of executor attempts recorded for this run (deferrals increment it).';



COMMENT ON COLUMN "public"."connect_payout_runs"."last_error" IS 'Last non-fatal executor error or deferral reason recorded for this run; diagnostic only, never a retry authority.';



COMMENT ON COLUMN "public"."connect_payout_runs"."action_required_reason" IS 'Why a run sits in the action_required stage. Only the account_not_actionable reason may be auto-resumed by a later actionable account update; every other action_required state requires an admin decision.';



CREATE TABLE IF NOT EXISTS "public"."disputes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "buyer_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "reason" "public"."dispute_reason" NOT NULL,
    "description" "text" NOT NULL,
    "buyer_evidence" "jsonb" DEFAULT '{"images": [], "video_url": null, "tech_checklist": {}}'::"jsonb",
    "seller_evidence" "jsonb" DEFAULT '{"images": [], "video_url": null}'::"jsonb",
    "status" "public"."dispute_status" DEFAULT 'open'::"public"."dispute_status",
    "admin_notes" "text",
    "resolution_type" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "locked_by" "uuid",
    "locked_at" timestamp with time zone,
    "resolved_by" "uuid",
    "return_label_url" "text",
    "return_tracking_number" "text",
    "return_delivered_at" timestamp with time zone,
    "return_payout_id" "text",
    "return_payout_status" "text" DEFAULT 'pending'::"text",
    "return_last_tracked_at" timestamp with time zone,
    "shipment_id" "uuid"
);


ALTER TABLE "public"."disputes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "buyer_id" "uuid" NOT NULL,
    "total_amount" numeric NOT NULL,
    "stripe_payment_intent_id" "text",
    "shipping_address" "jsonb" NOT NULL,
    "service_fee_amount" numeric DEFAULT 0,
    "currency" "text" DEFAULT 'MXN'::"text",
    "status" "public"."order_status_enum" DEFAULT 'pending'::"public"."order_status_enum" NOT NULL,
    "delivered_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "completed_at" timestamp with time zone,
    "stripe_charge_id" "text",
    "stripe_transfer_group" "text",
    "payment_processing" boolean DEFAULT false NOT NULL,
    "payment_processing_reason" "text",
    "actual_stripe_fee_cents" bigint,
    "stripe_fee_reconciled_at" timestamp with time zone,
    "cancellation_loss_cents" bigint,
    "compensation_state" "text",
    "compensation_attempt_count" integer DEFAULT 0 NOT NULL,
    "next_compensation_retry_at" timestamp with time zone,
    "compensation_lease_expires_at" timestamp with time zone,
    "stripe_refund_id" "text",
    "compensation_last_error" "text",
    CONSTRAINT "orders_compensation_state_check" CHECK ((("compensation_state" IS NULL) OR ("compensation_state" = ANY (ARRAY['refund_pending'::"text", 'refunding'::"text", 'refund_failed_retry_queued'::"text", 'refunded'::"text"]))))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."stripe_payment_intent_id" IS 'Single PaymentIntent ID for legacy wallet-era orders. NULL for Connect-era orders (see shipments.stripe_payment_intent_id per shipment).';



COMMENT ON COLUMN "public"."orders"."stripe_charge_id" IS 'Stripe Charge ID captured from the platform PaymentIntent on payment success. NULL until the webhook persists it.';



COMMENT ON COLUMN "public"."orders"."stripe_transfer_group" IS 'Stripe transfer_group used to group per-shipment platform->seller Transfers on manual release. NULL for legacy per-seller orders.';



COMMENT ON COLUMN "public"."orders"."payment_processing" IS 'True when the platform payment succeeded but order/shipment/allocation persistence failed and is pending ops recovery. Keeps status=pending until durable.';



COMMENT ON COLUMN "public"."orders"."payment_processing_reason" IS 'Human-readable reason for the current payment_processing recovery state. NULL when payment_processing=false.';



CREATE TABLE IF NOT EXISTS "public"."profiles_private" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "role" "text" DEFAULT 'user'::"text",
    "stripe_customer_id" "text",
    "phone_number" "text",
    "status" "public"."account_status" DEFAULT 'active'::"public"."account_status",
    "status_reason" "text",
    "status_updated_at" timestamp with time zone,
    "status_updated_by" "text",
    "last_sign_in_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "stripe_account_id" "text",
    "stripe_onboarding_status" "public"."stripe_onboarding_status" DEFAULT 'pending'::"public"."stripe_onboarding_status",
    "stripe_onboarding_refreshed_at" timestamp with time zone
);


ALTER TABLE "public"."profiles_private" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles_private"."stripe_account_id" IS 'Stripe Connect Account v2 ID (acct_...). NULL until seller starts onboarding.';



COMMENT ON COLUMN "public"."profiles_private"."stripe_onboarding_status" IS 'Stripe Connect onboarding state. Updated by account.updated webhook.';



CREATE OR REPLACE VIEW "public"."admin_connect_payout_release_view" WITH ("security_invoker"='true') AS
 WITH "shipment_amounts" AS (
         SELECT "s"."id" AS "shipment_id",
            "s"."seller_id",
            "s"."order_id",
            "s"."status",
            "s"."completed_at",
            "s"."stripe_payment_intent_id",
            "s"."stripe_payout_id",
            "s"."shipping_cost",
            "pp"."stripe_account_id",
            "pp"."stripe_onboarding_status",
            "p"."username" AS "seller_name",
            ("s"."status" = 'completed'::"public"."order_status_enum") AS "is_completed",
            ("s"."completed_at" IS NOT NULL) AS "has_completed_at",
            ("s"."stripe_payment_intent_id" IS NOT NULL) AS "has_connect_payment_intent",
            GREATEST(
                CASE
                    WHEN ("o"."stripe_transfer_group" IS NOT NULL) THEN ("round"((COALESCE("sum"("oi"."net_payout"), (0)::numeric) * (100)::numeric)))::integer
                    ELSE (("round"((COALESCE("sum"("oi"."net_payout"), (0)::numeric) * (100)::numeric)))::integer - COALESCE("s"."shipping_cost", 0))
                END, 0) AS "release_amount_cents",
            (("s"."shipping_cost" IS NOT NULL) AND ("s"."shipping_cost" > 0)) AS "has_shipping_cost_cents",
            (EXISTS ( SELECT 1
                   FROM "public"."disputes" "d"
                  WHERE (("d"."shipment_id" = "s"."id") AND ("d"."status" = ANY (ARRAY['open'::"public"."dispute_status", 'under_review'::"public"."dispute_status", 'waiting_return'::"public"."dispute_status", 'return_shipped'::"public"."dispute_status", 'return_delivered'::"public"."dispute_status"]))))) AS "has_active_dispute",
            (EXISTS ( SELECT 1
                   FROM "public"."connect_payout_run_shipments" "crs"
                  WHERE (("crs"."shipment_id" = "s"."id") AND ("crs"."status" = ANY (ARRAY['pending_reconciliation'::"text", 'paid'::"text", 'reconciliation_needed'::"text"]))))) AS "has_active_release",
            "o"."stripe_transfer_group" AS "transfer_group",
            "s"."stripe_transfer_id"
           FROM (((("public"."shipments" "s"
             JOIN "public"."orders" "o" ON (("o"."id" = "s"."order_id")))
             LEFT JOIN "public"."order_items" "oi" ON (("oi"."shipment_id" = "s"."id")))
             LEFT JOIN "public"."profiles_private" "pp" ON (("pp"."id" = "s"."seller_id")))
             LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "s"."seller_id")))
          GROUP BY "s"."id", "s"."seller_id", "s"."order_id", "s"."status", "s"."completed_at", "s"."stripe_payment_intent_id", "s"."stripe_payout_id", "s"."shipping_cost", "pp"."stripe_account_id", "pp"."stripe_onboarding_status", "p"."username", "o"."stripe_transfer_group", "s"."stripe_transfer_id"
        )
 SELECT "sa"."shipment_id",
    "sa"."seller_id",
    "sa"."seller_name",
    "sa"."order_id",
    "sa"."status",
    "sa"."completed_at",
    "sa"."stripe_payment_intent_id",
    "sa"."stripe_account_id",
    "sa"."stripe_onboarding_status",
    "sa"."release_amount_cents",
    ("sa"."is_completed" AND "sa"."has_completed_at" AND "sa"."has_connect_payment_intent" AND (NOT "sa"."has_active_dispute") AND (NOT "sa"."has_active_release") AND ("payout_run"."id" IS NULL) AND (("sa"."transfer_group" IS NOT NULL) OR "sa"."has_shipping_cost_cents") AND ("sa"."stripe_account_id" IS NOT NULL) AND ("sa"."stripe_onboarding_status" = 'complete'::"public"."stripe_onboarding_status") AND ("sa"."release_amount_cents" > 0)) AS "is_eligible",
        CASE
            WHEN (NOT "sa"."is_completed") THEN 'shipment_not_completed'::"text"
            WHEN (NOT "sa"."has_completed_at") THEN 'missing_completed_at'::"text"
            WHEN (NOT "sa"."has_connect_payment_intent") THEN 'missing_connect_payment_intent'::"text"
            WHEN "sa"."has_active_dispute" THEN 'active_dispute'::"text"
            WHEN "sa"."has_active_release" THEN 'already_released'::"text"
            WHEN ("payout_run"."status" = 'canceled'::"text") THEN 'payout_canceled_manual_review'::"text"
            WHEN ("payout_run"."status" = 'failed'::"text") THEN 'payout_failed_retry_required'::"text"
            WHEN ("payout_run"."id" IS NOT NULL) THEN 'payout_run_history_requires_review'::"text"
            WHEN (("sa"."transfer_group" IS NULL) AND (NOT "sa"."has_shipping_cost_cents")) THEN 'missing_shipping_cost'::"text"
            WHEN ("sa"."stripe_account_id" IS NULL) THEN 'missing_stripe_account'::"text"
            WHEN (("sa"."stripe_onboarding_status" <> 'complete'::"public"."stripe_onboarding_status") OR ("sa"."stripe_onboarding_status" IS NULL)) THEN 'seller_not_payout_ready'::"text"
            WHEN ("sa"."release_amount_cents" <= 0) THEN 'missing_release_amount'::"text"
            ELSE NULL::"text"
        END AS "ineligible_reason",
    "sa"."transfer_group",
    "sa"."stripe_transfer_id",
    "payout_run"."id" AS "payout_run_id",
    "payout_run"."status" AS "payout_run_status",
    "payout_run"."amount" AS "payout_run_amount_cents",
    "payout_run"."failure_reason" AS "payout_run_failure_reason",
    "payout_run"."failed_at" AS "payout_run_failed_at",
    "payout_run"."retry_of_run_id",
    COALESCE((("payout_run"."status" = 'failed'::"text") AND (NOT "payout_run"."has_protected_release") AND (NOT "payout_run"."has_retry_child")), false) AS "is_retryable",
    COALESCE(("payout_run"."status" = 'canceled'::"text"), false) AS "requires_manual_review",
    "payout_run"."paid_at" AS "payout_run_paid_at"
   FROM ("shipment_amounts" "sa"
     LEFT JOIN LATERAL ( SELECT "pr"."id",
            "pr"."status",
            "pr"."amount",
            "pr"."failure_reason",
            "pr"."failed_at",
            "pr"."paid_at",
            "pr"."retry_of_run_id",
            (EXISTS ( SELECT 1
                   FROM "public"."connect_payout_runs" "retry_child"
                  WHERE ("retry_child"."retry_of_run_id" = "pr"."id"))) AS "has_retry_child",
            (EXISTS ( SELECT 1
                   FROM ("public"."connect_payout_run_shipments" "source_mapping"
                     JOIN "public"."connect_payout_run_shipments" "protected_mapping" ON (("protected_mapping"."shipment_id" = "source_mapping"."shipment_id")))
                  WHERE (("source_mapping"."run_id" = "pr"."id") AND ("protected_mapping"."status" = ANY (ARRAY['pending_reconciliation'::"text", 'paid'::"text", 'reconciliation_needed'::"text"]))))) AS "has_protected_release"
           FROM ("public"."connect_payout_run_shipments" "crs"
             JOIN "public"."connect_payout_runs" "pr" ON (("pr"."id" = "crs"."run_id")))
          WHERE ("crs"."shipment_id" = "sa"."shipment_id")
          ORDER BY "pr"."created_at" DESC, "pr"."id" DESC
         LIMIT 1) "payout_run" ON (true));


ALTER VIEW "public"."admin_connect_payout_release_view" OWNER TO "postgres";


COMMENT ON COLUMN "public"."admin_connect_payout_release_view"."payout_run_paid_at" IS 'Selected run paid_at: observed Stripe payment event time, nullable; not irreversible bank receipt.';



CREATE OR REPLACE VIEW "public"."admin_disputes_monitor_view" WITH ("security_invoker"='true') AS
 SELECT "d"."id" AS "dispute_id",
    "d"."created_at" AS "dispute_date",
    "d"."updated_at" AS "resolved_at",
    "d"."status" AS "dispute_status",
    "left"("d"."description", 100) AS "dispute_description_preview",
    "d"."resolution_type",
    "o"."id" AS "order_id",
    "o"."total_amount",
    "o"."status" AS "order_status",
    "b"."id" AS "buyer_id",
    "b"."username" AS "buyer_username",
    "s"."id" AS "seller_id",
    "s"."username" AS "seller_username"
   FROM ((("public"."disputes" "d"
     LEFT JOIN "public"."orders" "o" ON (("d"."order_id" = "o"."id")))
     LEFT JOIN "public"."profiles" "b" ON (("d"."buyer_id" = "b"."id")))
     LEFT JOIN "public"."profiles" "s" ON (("d"."seller_id" = "s"."id")));


ALTER VIEW "public"."admin_disputes_monitor_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_requests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "wallet_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "status" "public"."payout_status" DEFAULT 'pending'::"public"."payout_status",
    "bank_account_id" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "processed_at" timestamp with time zone,
    "processed_by" "uuid",
    "notes" "text",
    "completed_at" timestamp with time zone,
    "rejected_reason" "text",
    "rejected_at" timestamp with time zone,
    CONSTRAINT "payout_requests_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."payout_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."payout_requests" IS 'DEPRECATED by Stripe Connect migration. Stripe Connect Express dashboard replaces manual payouts.';



CREATE TABLE IF NOT EXISTS "public"."seller_bank_accounts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "clabe" character varying(18) NOT NULL,
    "bank_name" "text",
    "account_holder_name" "text" NOT NULL,
    "is_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "seller_bank_accounts_clabe_check" CHECK ((("clabe")::"text" ~ '^\d{18}$'::"text"))
);


ALTER TABLE "public"."seller_bank_accounts" OWNER TO "postgres";


COMMENT ON TABLE "public"."seller_bank_accounts" IS 'DEPRECATED by Stripe Connect migration. Sellers provide banking info via Stripe onboarding.';



CREATE OR REPLACE VIEW "public"."admin_payments_overview" WITH ("security_invoker"='true') AS
 SELECT "pr"."id",
    "pr"."user_id",
    "p"."username" AS "seller_name",
    "pr"."amount",
    "pr"."status",
    "sba"."clabe",
    "sba"."bank_name",
    "sba"."is_verified",
    "sba"."account_holder_name",
    "pr"."requested_at",
    "pr"."processed_at",
    "pr"."processed_by",
    "pr"."completed_at",
    "pr"."rejected_reason",
    "pr"."rejected_at",
    "ap"."username" AS "processed_by_name"
   FROM ((("public"."payout_requests" "pr"
     JOIN "public"."seller_bank_accounts" "sba" ON (("sba"."id" = "pr"."bank_account_id")))
     JOIN "public"."profiles" "p" ON (("p"."id" = "pr"."user_id")))
     LEFT JOIN "public"."profiles" "ap" ON (("ap"."id" = "pr"."processed_by")));


ALTER VIEW "public"."admin_payments_overview" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "price" numeric NOT NULL,
    "category" "text" NOT NULL,
    "condition" "text" NOT NULL,
    "usage" "text" NOT NULL,
    "images" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "public"."product_status_enum" DEFAULT 'PENDING_VERIFICATION'::"public"."product_status_enum" NOT NULL,
    "specifications" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "views" integer DEFAULT 0 NOT NULL,
    "aspect_ratio" double precision DEFAULT 1.0 NOT NULL,
    "verification_data" "jsonb",
    "rejection_reason" "text",
    "shipping_cost" numeric DEFAULT 0,
    "shipping_payer" "text" DEFAULT 'buyer'::"text",
    "origin_zip" "text",
    "package_preset" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "reserved_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "locked_by" "uuid",
    "locked_at" timestamp with time zone,
    "fts" "tsvector",
    "deleted_at" timestamp with time zone,
    "publication_shipping_reserve_cents" bigint,
    "publication_commission_rate" numeric,
    "publication_insurance_rate" numeric,
    "status_before_account_hold" "public"."product_status_enum",
    CONSTRAINT "product_publication_economics_snapshot_check" CHECK (((("publication_shipping_reserve_cents" IS NULL) AND ("publication_commission_rate" IS NULL) AND ("publication_insurance_rate" IS NULL)) OR (("publication_shipping_reserve_cents" >= 0) AND ("publication_commission_rate" >= (0)::numeric) AND ("publication_commission_rate" <= (1)::numeric) AND ("publication_insurance_rate" >= (0)::numeric) AND ("publication_insurance_rate" <= (1)::numeric))))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products"."status_before_account_hold" IS 'Listing status captured when the seller account was suspended or banned; restored and cleared when a suspension is lifted. NULL means no account hold is tracked.';



CREATE OR REPLACE VIEW "public"."admin_product_queue_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "created_at",
    "name",
    "description",
    "price",
    "category",
    "condition",
    "usage",
    "images",
    "status",
    "specifications",
    "seller_id",
    "views",
    "aspect_ratio",
    "verification_data",
    "rejection_reason",
    "shipping_cost",
    "shipping_payer",
    "origin_zip",
    "package_preset",
    "updated_at",
    "reserved_at",
    "verified_at",
    "locked_by",
    "locked_at",
    "fts",
    "deleted_at"
   FROM "public"."products"
  WHERE (("status" = 'PENDING_VERIFICATION'::"public"."product_status_enum") AND ("deleted_at" IS NULL))
  ORDER BY "created_at";


ALTER VIEW "public"."admin_product_queue_view" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_seller_onboarding_view" WITH ("security_invoker"='true') AS
 SELECT "p"."id",
    "p"."username",
    "pp"."email",
    "pp"."stripe_account_id",
    "pp"."stripe_onboarding_status",
    (("pp"."stripe_onboarding_status" = 'complete'::"public"."stripe_onboarding_status") AND ("pp"."stripe_account_id" IS NOT NULL)) AS "charges_enabled",
    "p"."created_at"
   FROM ("public"."profiles" "p"
     JOIN "public"."profiles_private" "pp" ON (("pp"."id" = "p"."id")))
  WHERE (("p"."is_verified_seller" = true) OR ("pp"."stripe_account_id" IS NOT NULL));


ALTER VIEW "public"."admin_seller_onboarding_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "pending_balance" numeric(12,2) DEFAULT 0 NOT NULL,
    "available_balance" numeric(12,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'MXN'::"text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    CONSTRAINT "wallets_available_balance_check" CHECK (("available_balance" >= (0)::numeric)),
    CONSTRAINT "wallets_pending_balance_check" CHECK (("pending_balance" >= (0)::numeric))
);


ALTER TABLE "public"."wallets" OWNER TO "postgres";


COMMENT ON TABLE "public"."wallets" IS 'DEPRECATED by Stripe Connect migration (stripe-connect-migration). Keep read-only for audit.';



CREATE OR REPLACE VIEW "public"."admin_user_directory_view" WITH ("security_invoker"='true') AS
 SELECT "p"."id",
    "p"."username",
    "pp"."email",
    "p"."avatar_url",
    "pp"."role",
    "pp"."status",
    "p"."is_verified_seller",
    "p"."created_at",
    COALESCE("w"."available_balance", (0)::numeric) AS "available_balance",
    COALESCE("w"."pending_balance", (0)::numeric) AS "pending_balance"
   FROM (("public"."profiles" "p"
     LEFT JOIN "public"."profiles_private" "pp" ON (("p"."id" = "pp"."id")))
     LEFT JOIN "public"."wallets" "w" ON (("p"."id" = "w"."user_id")));


ALTER VIEW "public"."admin_user_directory_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_user_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "admin_id" "uuid",
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_user_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocked_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "blocker_id" "uuid" NOT NULL,
    "blocked_id" "uuid" NOT NULL
);


ALTER TABLE "public"."blocked_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_configurations" (
    "category_name" "text" NOT NULL,
    "sell_fields" "jsonb" NOT NULL,
    "filter_fields" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."category_configurations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkout_recovery_shells" (
    "stripe_payment_intent_id" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "source_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "charged_amount_cents" bigint,
    "compensation_state" "text" DEFAULT 'refund_pending'::"text" NOT NULL,
    "compensation_attempt_count" integer DEFAULT 0 NOT NULL,
    "next_compensation_retry_at" timestamp with time zone,
    "compensation_lease_expires_at" timestamp with time zone,
    "stripe_refund_id" "text",
    "compensation_last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_charge_id" "text",
    CONSTRAINT "checkout_recovery_shells_compensation_state_check" CHECK (("compensation_state" = ANY (ARRAY['refund_pending'::"text", 'refunding'::"text", 'refund_failed_retry_queued'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."checkout_recovery_shells" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connect_account_actionability" (
    "stripe_account_id" "text" NOT NULL,
    "is_actionable" boolean NOT NULL,
    "blocked_reason" "text",
    "payouts_enabled" boolean,
    "external_account_status" "text",
    "source_event_id" "text",
    "stripe_created" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "refresh_generation" bigint DEFAULT 0 NOT NULL,
    "refresh_pending" boolean DEFAULT false NOT NULL,
    "current_external_account_id" "text",
    "current_observed_at" timestamp with time zone,
    "current_currency" "text",
    "current_default_for_currency" boolean,
    "current_mxn_default_count" integer,
    CONSTRAINT "connect_account_actionability_refresh_generation_check" CHECK (("refresh_generation" >= 0))
);


ALTER TABLE "public"."connect_account_actionability" OWNER TO "postgres";


COMMENT ON TABLE "public"."connect_account_actionability" IS 'Payout gate: legacy compatibility until refreshed, then generation-fenced current Stripe MXN destination snapshots with fail-closed pending refreshes. Signed evidence stays separate and immutable.';



COMMENT ON COLUMN "public"."connect_account_actionability"."blocked_reason" IS 'Documented non-actionable external-account status (errored, verification_failed, tokenized_account_number_deactivated) or payouts_disabled when the account-level payouts_enabled flag is false.';



COMMENT ON COLUMN "public"."connect_account_actionability"."source_event_id" IS 'Signed Stripe trigger event identity bound to this account and refresh generation, NOT current destination identity. A duplicate trigger may acquire another generation.';



COMMENT ON COLUMN "public"."connect_account_actionability"."stripe_created" IS 'Occurrence timestamp of the signed trigger event, copied from immutable evidence. Provenance only after generation adoption; never current-state ordering or observation time.';



COMMENT ON COLUMN "public"."connect_account_actionability"."refresh_generation" IS 'Monotonic per-account Selene refresh epoch, not Stripe mutation ordering. Zero means legacy projection; only acquire increments it.';



COMMENT ON COLUMN "public"."connect_account_actionability"."refresh_pending" IS 'Acquire sets TRUE and is_actionable FALSE before network reads. Failed retrieval remains pending; only a current-generation commit clears it.';



COMMENT ON COLUMN "public"."connect_account_actionability"."current_external_account_id" IS 'Current server-retrieved MXN default bank identity; distinct from the historical bank in connect_account_events. Usable only when refresh_pending is FALSE.';



COMMENT ON COLUMN "public"."connect_account_actionability"."current_observed_at" IS 'Database receipt time of the last accepted server snapshot, not Stripe event creation or a claimed Stripe mutation time. Prior snapshot remains historical while pending.';



CREATE TABLE IF NOT EXISTS "public"."connect_account_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stripe_event_id" "text" NOT NULL,
    "stripe_account_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "stripe_created" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payouts_enabled" boolean,
    "external_account_id" "text",
    "external_account_status" "text",
    CONSTRAINT "connect_account_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['account.updated'::"text", 'account.external_account.created'::"text", 'account.external_account.updated'::"text", 'account.external_account.deleted'::"text"])))
);


ALTER TABLE "public"."connect_account_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."connect_account_events" IS 'Append-only, immutable Stripe account/external-account event evidence keyed by Stripe event identity; the derived per-account actionability is a projection rebuilt from this evidence, and it never mutates the Phase 2A payout event ledger.';



COMMENT ON COLUMN "public"."connect_account_events"."stripe_event_id" IS 'Immutable signed event identity. Duplicate evidence stays unchanged, but webhook retry must re-read current state under a new refresh generation.';



COMMENT ON COLUMN "public"."connect_account_events"."payouts_enabled" IS 'Account-level payouts_enabled carried by the signed event; NULL when the field is absent or undocumented.';



COMMENT ON COLUMN "public"."connect_account_events"."external_account_id" IS 'External bank-account id carried by the signed event, when parseable; NULL when absent or not parseable. Evidence only: identity attribution, never an actionability input by itself.';



COMMENT ON COLUMN "public"."connect_account_events"."external_account_status" IS 'Historical bank status extracted from the signed event. An external-account event may concern an old or non-default bank; this field is never the current destination authority.';



CREATE TABLE IF NOT EXISTS "public"."connect_payout_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stripe_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "stripe_payout_id" "text" NOT NULL,
    "connect_payout_run_id" "uuid",
    "stripe_created" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "observed_payout_status" "text" NOT NULL,
    "failure_code" "text",
    "failure_message" "text",
    "failure_balance_transaction" "text",
    CONSTRAINT "connect_payout_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['payout.created'::"text", 'payout.updated'::"text", 'payout.paid'::"text", 'payout.failed'::"text", 'payout.canceled'::"text"]))),
    CONSTRAINT "connect_payout_events_observed_payout_status_check" CHECK (("observed_payout_status" = ANY (ARRAY['pending'::"text", 'in_transit'::"text", 'paid'::"text", 'failed'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."connect_payout_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."connect_payout_events" IS 'Append-only, immutable Stripe Connect payout event evidence keyed by Stripe event identity; the aggregate payout-run status is a projection rebuilt from this evidence plus authoritative Stripe state.';



COMMENT ON COLUMN "public"."connect_payout_events"."stripe_event_id" IS 'Stripe event.id; duplicate webhook deliveries dedupe on this identity and must never create a second evidence row or a second projection.';



COMMENT ON COLUMN "public"."connect_payout_events"."stripe_created" IS 'Stripe occurrence time (event.created); webhook arrival order is not occurrence order.';



COMMENT ON COLUMN "public"."connect_payout_events"."observed_payout_status" IS 'Observed Stripe payout state carried by the event (pending, in_transit, paid, failed, canceled).';



COMMENT ON COLUMN "public"."connect_payout_events"."failure_balance_transaction" IS 'Stripe balance transaction returning payout funds to the Stripe balance after a payout failure; evidence for late paid→failed reversal.';



CREATE TABLE IF NOT EXISTS "public"."favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL
);


ALTER TABLE "public"."favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mexico_banks" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."mexico_banks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mexico_zips" (
    "id" bigint NOT NULL,
    "zip_code" "text",
    "district" "text",
    "city" "text",
    "state_name" "text",
    "state_code" "text"
);


ALTER TABLE "public"."mexico_zips" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."mexico_zips_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."mexico_zips_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."mexico_zips_id_seq" OWNED BY "public"."mexico_zips"."id";



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text",
    "title" "text" NOT NULL,
    "message" "text",
    "read" boolean DEFAULT false,
    "action_path" "text",
    "deleted_at" timestamp with time zone,
    "event_kind" "text",
    "source_event_key" "text",
    "event_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "notifications_event_identity_pair_chk" CHECK (((("event_kind" IS NULL) AND ("source_event_key" IS NULL)) OR (("event_kind" IS NOT NULL) AND ("source_event_key" IS NOT NULL)))),
    CONSTRAINT "notifications_event_kind_catalogue_chk" CHECK ((("event_kind" IS NULL) OR ("event_kind" = ANY (ARRAY['order.payment_confirmed'::"text", 'shipment.cancelled'::"text", 'dispute.opened'::"text", 'dispute.verdict'::"text", 'product.approved'::"text", 'product.approved_with_note'::"text", 'product.rejected'::"text", 'return.seller_evidence_submitted'::"text", 'return.delivered'::"text"])))),
    CONSTRAINT "notifications_event_payload_object_chk" CHECK (("jsonb_typeof"("event_payload") = 'object'::"text")),
    CONSTRAINT "notifications_source_event_key_nonempty_chk" CHECK ((("source_event_key" IS NULL) OR ("length"("btrim"("source_event_key")) > 0))),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['info'::"text", 'success'::"text", 'error'::"text", 'warning'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_methods" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_payment_method_id" "text" NOT NULL,
    "brand" "text" NOT NULL,
    "last4" "text" NOT NULL,
    "exp_month" integer NOT NULL,
    "exp_year" integer NOT NULL,
    "is_default" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."payment_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "rating" integer NOT NULL,
    "comment" "text",
    "order_id" "uuid",
    "shipment_id" "uuid",
    CONSTRAINT "no_self_rating" CHECK (("reviewer_id" <> "seller_id")),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."seller_trust_stats" WITH ("security_invoker"='true') AS
 SELECT "seller_id",
    "count"(*) AS "total_listings",
    "count"(*) FILTER (WHERE ("status" = 'VERIFIED'::"public"."product_status_enum")) AS "verified_count",
    "count"(*) FILTER (WHERE ("status" = 'IN_REVIEW'::"public"."product_status_enum")) AS "in_review_count",
    "count"(*) FILTER (WHERE ("status" = 'REJECTED'::"public"."product_status_enum")) AS "rejected_count",
    "count"(*) FILTER (WHERE ("status" = 'SOLD'::"public"."product_status_enum")) AS "sold_count",
    "count"(*) FILTER (WHERE ("status" = ANY (ARRAY['VERIFIED'::"public"."product_status_enum", 'SOLD'::"public"."product_status_enum", 'REJECTED'::"public"."product_status_enum"]))) AS "processed_count"
   FROM "public"."products"
  WHERE ("deleted_at" IS NULL)
  GROUP BY "seller_id";


ALTER VIEW "public"."seller_trust_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shipment_cancellation_operations" (
    "shipment_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "operation_key" "text" GENERATED ALWAYS AS (('cancel_shipment_'::"text" || ("shipment_id")::"text")) STORED,
    "source" "text" NOT NULL,
    "actor_id" "uuid",
    "reason" "text" NOT NULL,
    "claim_token" "uuid" NOT NULL,
    "claim_expires_at" timestamp with time zone NOT NULL,
    "external_started_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "refund_request" "jsonb",
    "cancellation_loss_cents" bigint,
    CONSTRAINT "shipment_cancellation_operations_cancellation_loss_cents_check" CHECK (("cancellation_loss_cents" >= 0)),
    CONSTRAINT "shipment_cancellation_operations_check" CHECK (((("source" = ANY (ARRAY['buyer'::"text", 'seller'::"text"])) AND ("actor_id" IS NOT NULL)) OR (("source" = ANY (ARRAY['paid_timeout'::"text", 'preparing_timeout'::"text"])) AND ("actor_id" IS NULL)))),
    CONSTRAINT "shipment_cancellation_operations_reason_check" CHECK (("length"("btrim"("reason")) > 0)),
    CONSTRAINT "shipment_cancellation_operations_source_check" CHECK (("source" = ANY (ARRAY['buyer'::"text", 'seller'::"text", 'paid_timeout'::"text", 'preparing_timeout'::"text"])))
);


ALTER TABLE "public"."shipment_cancellation_operations" OWNER TO "postgres";


COMMENT ON TABLE "public"."shipment_cancellation_operations" IS 'One durable cancellation identity per shipment. Only claim/start RPCs write it. B2 will extend this same operation with refund identity/status/recovery; TTL never clears external_started_at.';



COMMENT ON COLUMN "public"."shipment_cancellation_operations"."external_started_at" IS 'Write-ahead fence set before a possible external call. Not proof of Stripe success. Once set, no claim or repeated start authorizes another call, regardless of lease expiry.';



COMMENT ON COLUMN "public"."shipment_cancellation_operations"."refund_request" IS 'Exact server-reconstructed Stripe refund params, frozen atomically with external_started_at. Not a refund result; existing B1.1 fences are never reopened.';



COMMENT ON COLUMN "public"."shipment_cancellation_operations"."cancellation_loss_cents" IS 'Frozen proportional actual Stripe fee loss for the later DB cancellation. NULL means reconciliation was unavailable, not zero.';



CREATE TABLE IF NOT EXISTS "public"."shipment_completion_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shipment_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "actor_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_connect" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shipment_completion_events_actor_source_check" CHECK (((("source" = 'buyer'::"text") AND ("actor_id" IS NOT NULL)) OR (("source" = 'auto'::"text") AND ("actor_id" IS NULL)))),
    CONSTRAINT "shipment_completion_events_source_check" CHECK (("source" = ANY (ARRAY['buyer'::"text", 'auto'::"text"])))
);


ALTER TABLE "public"."shipment_completion_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shipment_label_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shipment_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shipment_label_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['claimed'::"text", 'sent'::"text", 'rejected'::"text", 'orphaned'::"text", 'generated'::"text", 'reconciled'::"text"]))),
    CONSTRAINT "shipment_label_events_metadata_check" CHECK ((NOT ("metadata" ?| ARRAY['name'::"text", 'phone'::"text", 'street'::"text", 'number'::"text", 'district'::"text", 'label_url'::"text", 'raw_provider_response'::"text", 'token'::"text", 'authorization'::"text"])))
);


ALTER TABLE "public"."shipment_label_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shipment_tracking_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shipment_id" "uuid" NOT NULL,
    "dispute_id" "uuid",
    "event_type" "public"."shipment_tracking_event_type" NOT NULL,
    "event_at" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "raw_status" "text" NOT NULL,
    "location" "text",
    "status_description" "text",
    "carrier_name" "text",
    "webhook_delivery_id" "uuid",
    "polling_run_id" "uuid"
);


ALTER TABLE "public"."shipment_tracking_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "level" "text" DEFAULT 'ERROR'::"text",
    "message" "text" NOT NULL,
    "stack_trace" "text",
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."system_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "id" integer NOT NULL,
    "is_maintenance" boolean DEFAULT false,
    "min_version_android" "text" DEFAULT '1.0.0'::"text",
    "min_version_ios" "text" DEFAULT '1.0.0'::"text",
    "service_fee_pct" numeric DEFAULT 0.05,
    "service_fee_fixed_cents" integer DEFAULT 500,
    "insurance_rate" numeric DEFAULT 0.012,
    "payout_fee_fixed_cents" integer DEFAULT 2000,
    "currency" "text" DEFAULT 'MXN'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "shipping_buffer_cents" integer DEFAULT 5000,
    "package_presets" "jsonb" DEFAULT '{"cpu_1": {"width": 15, "height": 15, "length": 15, "weight": 1}, "cpu_2": {"width": 15, "height": 10, "length": 20, "weight": 1}, "gpu_1": {"width": 30, "height": 20, "length": 41, "weight": 5}, "ram_1": {"width": 15, "height": 15, "length": 15, "weight": 1}, "ram_2": {"width": 15, "height": 10, "length": 20, "weight": 1}, "mobo_1": {"width": 30, "height": 15, "length": 46, "weight": 5}}'::"jsonb",
    "return_label_fee_cents" integer DEFAULT 20000,
    "order_expiration_hours" integer DEFAULT 48,
    "min_payout_amount_cents" integer DEFAULT 10000,
    "preparing_expiration_hours" integer DEFAULT 96,
    "auto_cancel_orders_running" boolean DEFAULT false,
    "auto_cancel_preparing_running" boolean DEFAULT false,
    "return_delivery_timeout_running" boolean DEFAULT false,
    "release_funds_running" boolean DEFAULT false,
    "isr_withholding_pct" numeric DEFAULT 0.01,
    "iva_withholding_pct" numeric DEFAULT 0.08,
    "connect_enabled" boolean DEFAULT false,
    "novice_completed_threshold" integer DEFAULT 3,
    "novice_active_limit" integer DEFAULT 3,
    "trusted_active_limit" integer DEFAULT 10,
    "envia_carrier" "text",
    "envia_service" "text",
    "envia_print_format" "text",
    "envia_print_size" "text",
    "listing_quote_reference_destination" "jsonb",
    "checkout_recovery_enabled" boolean DEFAULT false NOT NULL,
    "checkout_recovery_running" boolean DEFAULT false NOT NULL,
    "track_shipments_preparing_lease_id" "uuid",
    "track_shipments_preparing_lease_expires_at" timestamp with time zone,
    "track_shipments_shipped_lease_id" "uuid",
    "track_shipments_shipped_lease_expires_at" timestamp with time zone,
    CONSTRAINT "system_settings_envia_tuple_check" CHECK (((("envia_carrier" IS NULL) AND ("envia_service" IS NULL) AND ("envia_print_format" IS NULL) AND ("envia_print_size" IS NULL) AND ("listing_quote_reference_destination" IS NULL)) OR (("envia_carrier" = 'paquetexpress'::"text") AND ("lower"("regexp_replace"("btrim"("envia_service"), '\s+'::"text", ' '::"text", 'g'::"text")) = 'ground'::"text") AND ("length"(TRIM(BOTH FROM "envia_print_format")) > 0) AND ("length"(TRIM(BOTH FROM "envia_print_size")) > 0) AND ("jsonb_typeof"("listing_quote_reference_destination") = 'object'::"text") AND ("listing_quote_reference_destination" ?& ARRAY['name'::"text", 'phone'::"text", 'street'::"text", 'number'::"text", 'district'::"text", 'city'::"text", 'state'::"text", 'country'::"text", 'postalCode'::"text"]) AND ("length"(TRIM(BOTH FROM ("listing_quote_reference_destination" ->> 'name'::"text"))) > 0) AND ("length"(TRIM(BOTH FROM ("listing_quote_reference_destination" ->> 'phone'::"text"))) > 0) AND ("length"(TRIM(BOTH FROM ("listing_quote_reference_destination" ->> 'street'::"text"))) > 0) AND ("length"(TRIM(BOTH FROM ("listing_quote_reference_destination" ->> 'number'::"text"))) > 0) AND ("length"(TRIM(BOTH FROM ("listing_quote_reference_destination" ->> 'district'::"text"))) > 0) AND ("length"(TRIM(BOTH FROM ("listing_quote_reference_destination" ->> 'city'::"text"))) > 0) AND ("length"(TRIM(BOTH FROM ("listing_quote_reference_destination" ->> 'state'::"text"))) > 0) AND ("upper"(("listing_quote_reference_destination" ->> 'state'::"text")) <> 'MX'::"text") AND (("listing_quote_reference_destination" ->> 'country'::"text") = 'MX'::"text") AND (("listing_quote_reference_destination" ->> 'postalCode'::"text") ~ '^[0-9]{5}$'::"text")))),
    CONSTRAINT "system_settings_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."system_settings"."service_fee_pct" IS 'Legacy/Selene marketplace commission percentage. In Stripe Connect checkout this is a seller-side deduction, not a buyer charge.';



COMMENT ON COLUMN "public"."system_settings"."service_fee_fixed_cents" IS 'Legacy fixed buyer service fee in centavos. Do not use for Stripe Connect buyer totals; v1 Connect checkout charges buyer subtotal + Seguro Selene only.';



COMMENT ON COLUMN "public"."system_settings"."shipping_buffer_cents" IS 'Seller-side logistics buffer in centavos used by seller earnings estimates. Buyer does not pay seller shipping in Stripe Connect checkout.';



COMMENT ON COLUMN "public"."system_settings"."isr_withholding_pct" IS 'Porcentaje de retención ISR (Art. 113-A LISR). Default: 1% = 0.01';



COMMENT ON COLUMN "public"."system_settings"."iva_withholding_pct" IS 'Porcentaje de retención IVA para plataformas tecnológicas. Default: 8% = 0.08';



COMMENT ON COLUMN "public"."system_settings"."connect_enabled" IS 'Feature flag: when true, checkout uses Stripe Connect multi-PI flow. Webhook routing is independent of this flag.';



CREATE TABLE IF NOT EXISTS "public"."wallet_transactions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "wallet_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "fee_deducted" numeric(12,2) DEFAULT 0.00,
    "shipping_cost" numeric(12,2) DEFAULT 0.00,
    "net_amount" numeric(12,2) NOT NULL,
    "balance_after" numeric(12,2) NOT NULL,
    "type" "public"."wallet_transaction_type" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "insurance_amount" numeric(12,2) DEFAULT 0.00,
    "shipment_id" "uuid",
    "tax_withholding" numeric
);


ALTER TABLE "public"."wallet_transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."wallet_transactions" IS 'DEPRECATED by Stripe Connect migration. Keep read-only for audit.';



COMMENT ON COLUMN "public"."wallet_transactions"."tax_withholding" IS 'Monto retenido por SAT en esta transacción (ISR 1% + IVA 8%).';



CREATE TABLE IF NOT EXISTS "public"."webhook_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "delivery_id" "text" NOT NULL,
    "event_name" "text" NOT NULL,
    "payload_sha256" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "state" "text" DEFAULT 'received'::"text" NOT NULL,
    "error_code" "text",
    CONSTRAINT "webhook_deliveries_state_check" CHECK (("state" = ANY (ARRAY['received'::"text", 'processed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."webhook_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_dlq" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" DEFAULT 'unknown'::"text",
    "payload" "jsonb" NOT NULL,
    "error_message" "text" NOT NULL,
    "resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid"
);


ALTER TABLE "public"."webhook_dlq" OWNER TO "postgres";


ALTER TABLE ONLY "public"."mexico_zips" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."mexico_zips_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."addresses"
    ADD CONSTRAINT "addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_user_notes"
    ADD CONSTRAINT "admin_user_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocker_id_blocked_id_key" UNIQUE ("blocker_id", "blocked_id");



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."category_configurations"
    ADD CONSTRAINT "category_configurations_pkey" PRIMARY KEY ("category_name");



ALTER TABLE ONLY "public"."checkout_recovery_shells"
    ADD CONSTRAINT "checkout_recovery_shells_pkey" PRIMARY KEY ("stripe_payment_intent_id");



ALTER TABLE ONLY "public"."connect_account_actionability"
    ADD CONSTRAINT "connect_account_actionability_pkey" PRIMARY KEY ("stripe_account_id");



ALTER TABLE ONLY "public"."connect_account_events"
    ADD CONSTRAINT "connect_account_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connect_account_events"
    ADD CONSTRAINT "connect_account_events_stripe_event_id_key" UNIQUE ("stripe_event_id");



ALTER TABLE ONLY "public"."connect_payout_events"
    ADD CONSTRAINT "connect_payout_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connect_payout_events"
    ADD CONSTRAINT "connect_payout_events_stripe_event_id_key" UNIQUE ("stripe_event_id");



ALTER TABLE ONLY "public"."connect_payout_run_shipments"
    ADD CONSTRAINT "connect_payout_run_shipments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connect_payout_run_shipments"
    ADD CONSTRAINT "connect_payout_run_shipments_run_id_shipment_id_key" UNIQUE ("run_id", "shipment_id");



ALTER TABLE ONLY "public"."connect_payout_runs"
    ADD CONSTRAINT "connect_payout_runs_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."connect_payout_runs"
    ADD CONSTRAINT "connect_payout_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_shipment_id_key" UNIQUE ("shipment_id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_user_id_product_id_key" UNIQUE ("user_id", "product_id");



ALTER TABLE ONLY "public"."mexico_banks"
    ADD CONSTRAINT "mexico_banks_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."mexico_zips"
    ADD CONSTRAINT "mexico_zips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_stripe_payment_method_id_key" UNIQUE ("stripe_payment_method_id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles_private"
    ADD CONSTRAINT "profiles_private_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_id_product_id_key" UNIQUE ("reviewer_id", "product_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_shipment_product_unique" UNIQUE ("reviewer_id", "shipment_id", "product_id");



ALTER TABLE ONLY "public"."seller_bank_accounts"
    ADD CONSTRAINT "seller_bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seller_bank_accounts"
    ADD CONSTRAINT "seller_bank_accounts_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."shipment_cancellation_operations"
    ADD CONSTRAINT "shipment_cancellation_operations_pkey" PRIMARY KEY ("shipment_id");



ALTER TABLE ONLY "public"."shipment_completion_events"
    ADD CONSTRAINT "shipment_completion_events_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."shipment_completion_events"
    ADD CONSTRAINT "shipment_completion_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shipment_completion_events"
    ADD CONSTRAINT "shipment_completion_events_shipment_id_key" UNIQUE ("shipment_id");



ALTER TABLE ONLY "public"."shipment_label_events"
    ADD CONSTRAINT "shipment_label_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shipment_tracking_events"
    ADD CONSTRAINT "shipment_tracking_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shipments"
    ADD CONSTRAINT "shipments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_fee_reconciliation_jobs"
    ADD CONSTRAINT "stripe_fee_reconciliation_job_order_id_stripe_payment_inten_key" UNIQUE ("order_id", "stripe_payment_intent_id");



ALTER TABLE ONLY "public"."stripe_fee_reconciliation_jobs"
    ADD CONSTRAINT "stripe_fee_reconciliation_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_logs"
    ADD CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_provider_delivery_id_key" UNIQUE ("provider", "delivery_id");



ALTER TABLE ONLY "public"."webhook_dlq"
    ADD CONSTRAINT "webhook_dlq_pkey" PRIMARY KEY ("id");



CREATE INDEX "checkout_recovery_shells_claim_idx" ON "public"."checkout_recovery_shells" USING "btree" ("next_compensation_retry_at", "created_at") WHERE ("compensation_state" = ANY (ARRAY['refund_pending'::"text", 'refund_failed_retry_queued'::"text", 'refunding'::"text"]));



CREATE INDEX "idx_addresses_user_id" ON "public"."addresses" USING "btree" ("user_id");



CREATE INDEX "idx_connect_account_events_account_id" ON "public"."connect_account_events" USING "btree" ("stripe_account_id", "stripe_created");



CREATE INDEX "idx_connect_payout_events_event_type" ON "public"."connect_payout_events" USING "btree" ("event_type");



CREATE INDEX "idx_connect_payout_events_run_id" ON "public"."connect_payout_events" USING "btree" ("connect_payout_run_id");



CREATE INDEX "idx_connect_payout_events_stripe_payout_id" ON "public"."connect_payout_events" USING "btree" ("stripe_payout_id", "stripe_created");



CREATE UNIQUE INDEX "idx_connect_payout_run_shipments_active_once" ON "public"."connect_payout_run_shipments" USING "btree" ("shipment_id") WHERE ("status" = ANY (ARRAY['pending_reconciliation'::"text", 'paid'::"text", 'reconciliation_needed'::"text"]));



CREATE INDEX "idx_connect_payout_run_shipments_run_id" ON "public"."connect_payout_run_shipments" USING "btree" ("run_id");



CREATE INDEX "idx_connect_payout_run_shipments_shipment_id" ON "public"."connect_payout_run_shipments" USING "btree" ("shipment_id");



CREATE INDEX "idx_connect_payout_run_shipments_transfer_started" ON "public"."connect_payout_run_shipments" USING "btree" ("shipment_id") WHERE ("transfer_started_at" IS NOT NULL);



CREATE INDEX "idx_connect_payout_runs_actor_id" ON "public"."connect_payout_runs" USING "btree" ("actor_id");



CREATE UNIQUE INDEX "idx_connect_payout_runs_one_retry_per_parent" ON "public"."connect_payout_runs" USING "btree" ("retry_of_run_id") WHERE ("retry_of_run_id" IS NOT NULL);



CREATE INDEX "idx_connect_payout_runs_release_stage_next_attempt" ON "public"."connect_payout_runs" USING "btree" ("release_stage", "next_attempt_at") WHERE (("status" = 'pending_reconciliation'::"text") AND ("stripe_payout_id" IS NULL));



CREATE INDEX "idx_connect_payout_runs_seller_id" ON "public"."connect_payout_runs" USING "btree" ("seller_id");



CREATE INDEX "idx_connect_payout_runs_stripe_payout_id" ON "public"."connect_payout_runs" USING "btree" ("stripe_payout_id") WHERE ("stripe_payout_id" IS NOT NULL);



CREATE INDEX "idx_disputes_created_at" ON "public"."disputes" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_disputes_locked_by" ON "public"."disputes" USING "btree" ("locked_by");



CREATE INDEX "idx_disputes_order_id" ON "public"."disputes" USING "btree" ("order_id");



CREATE INDEX "idx_disputes_return_last_tracked" ON "public"."disputes" USING "btree" ("return_last_tracked_at");



CREATE INDEX "idx_disputes_shipment_id" ON "public"."disputes" USING "btree" ("shipment_id");



CREATE INDEX "idx_disputes_status" ON "public"."disputes" USING "btree" ("status");



CREATE INDEX "idx_mexico_zips_code" ON "public"."mexico_zips" USING "btree" ("zip_code");



CREATE INDEX "idx_order_items_seller_id" ON "public"."order_items" USING "btree" ("seller_id");



CREATE INDEX "idx_order_items_shipment_id" ON "public"."order_items" USING "btree" ("shipment_id");



CREATE INDEX "idx_orders_delivered_at" ON "public"."orders" USING "btree" ("delivered_at") WHERE ("status" = 'delivered'::"public"."order_status_enum");



CREATE INDEX "idx_orders_payment_processing" ON "public"."orders" USING "btree" ("payment_processing") WHERE ("payment_processing" = true);



CREATE INDEX "idx_orders_status" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "idx_orders_stripe_charge_id" ON "public"."orders" USING "btree" ("stripe_charge_id") WHERE ("stripe_charge_id" IS NOT NULL);



CREATE INDEX "idx_orders_stripe_transfer_group" ON "public"."orders" USING "btree" ("stripe_transfer_group") WHERE ("stripe_transfer_group" IS NOT NULL);



CREATE UNIQUE INDEX "idx_orders_stripe_transfer_group_unique" ON "public"."orders" USING "btree" ("stripe_transfer_group") WHERE ("stripe_transfer_group" IS NOT NULL);



CREATE INDEX "idx_products_fts" ON "public"."products" USING "gin" ("fts");



CREATE INDEX "idx_products_reserved_status_reserved_at" ON "public"."products" USING "btree" ("status", "reserved_at") WHERE ("status" = 'RESERVED'::"public"."product_status_enum");



CREATE INDEX "idx_products_specifications" ON "public"."products" USING "gin" ("specifications");



CREATE INDEX "idx_profiles_private_stripe_account_id" ON "public"."profiles_private" USING "btree" ("stripe_account_id") WHERE ("stripe_account_id" IS NOT NULL);



CREATE INDEX "idx_reviews_shipment_id" ON "public"."reviews" USING "btree" ("shipment_id");



CREATE INDEX "idx_shipments_auto_completion_due" ON "public"."shipments" USING "btree" ("delivered_at") WHERE (("status" = 'delivered'::"public"."order_status_enum") AND ("buyer_confirmed_at" IS NULL) AND ("delivered_at" IS NOT NULL));



CREATE INDEX "idx_shipments_order_id" ON "public"."shipments" USING "btree" ("order_id");



CREATE INDEX "idx_shipments_seller_id" ON "public"."shipments" USING "btree" ("seller_id");



CREATE INDEX "idx_shipments_stripe_payment_intent_id" ON "public"."shipments" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "idx_shipments_stripe_transfer_id" ON "public"."shipments" USING "btree" ("stripe_transfer_id") WHERE ("stripe_transfer_id" IS NOT NULL);



CREATE INDEX "idx_wallet_transactions_shipment_id" ON "public"."wallet_transactions" USING "btree" ("shipment_id");



CREATE INDEX "idx_wallet_transactions_wallet_id" ON "public"."wallet_transactions" USING "btree" ("wallet_id");



CREATE INDEX "idx_wallets_user_id" ON "public"."wallets" USING "btree" ("user_id");



CREATE INDEX "idx_webhook_dlq_event_type" ON "public"."webhook_dlq" USING "btree" ("event_type");



CREATE INDEX "idx_webhook_dlq_resolved" ON "public"."webhook_dlq" USING "btree" ("resolved") WHERE ("resolved" = false);



CREATE INDEX "ix_admin_audit_logs_admin_id" ON "public"."admin_audit_logs" USING "btree" ("admin_id");



CREATE INDEX "ix_admin_user_notes_admin_id" ON "public"."admin_user_notes" USING "btree" ("admin_id");



CREATE INDEX "ix_admin_user_notes_user_id" ON "public"."admin_user_notes" USING "btree" ("user_id");



CREATE INDEX "ix_blocked_users_blocked_id" ON "public"."blocked_users" USING "btree" ("blocked_id");



CREATE INDEX "ix_disputes_buyer_id" ON "public"."disputes" USING "btree" ("buyer_id");



CREATE INDEX "ix_disputes_resolved_by" ON "public"."disputes" USING "btree" ("resolved_by");



CREATE INDEX "ix_disputes_seller_id" ON "public"."disputes" USING "btree" ("seller_id");



CREATE INDEX "ix_favorites_product_id" ON "public"."favorites" USING "btree" ("product_id");



CREATE INDEX "ix_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "ix_order_items_order_id" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "ix_order_items_product_id" ON "public"."order_items" USING "btree" ("product_id");



CREATE INDEX "ix_orders_buyer_id" ON "public"."orders" USING "btree" ("buyer_id");



CREATE INDEX "ix_payment_methods_user_id" ON "public"."payment_methods" USING "btree" ("user_id");



CREATE INDEX "ix_payout_requests_bank_account_id" ON "public"."payout_requests" USING "btree" ("bank_account_id");



CREATE INDEX "ix_payout_requests_processed_by" ON "public"."payout_requests" USING "btree" ("processed_by");



CREATE INDEX "ix_payout_requests_user_id" ON "public"."payout_requests" USING "btree" ("user_id");



CREATE INDEX "ix_payout_requests_wallet_id" ON "public"."payout_requests" USING "btree" ("wallet_id");



CREATE INDEX "ix_products_locked_by" ON "public"."products" USING "btree" ("locked_by");



CREATE INDEX "ix_products_seller_id" ON "public"."products" USING "btree" ("seller_id");



CREATE INDEX "ix_reports_reporter_id" ON "public"."reports" USING "btree" ("reporter_id");



CREATE INDEX "ix_reviews_product_id" ON "public"."reviews" USING "btree" ("product_id");



CREATE INDEX "ix_reviews_seller_id" ON "public"."reviews" USING "btree" ("seller_id");



CREATE INDEX "ix_system_logs_user_id" ON "public"."system_logs" USING "btree" ("user_id");



CREATE INDEX "ix_wallet_transactions_order_id" ON "public"."wallet_transactions" USING "btree" ("order_id");



CREATE INDEX "ix_webhook_dlq_resolved_by" ON "public"."webhook_dlq" USING "btree" ("resolved_by");



CREATE UNIQUE INDEX "notifications_source_event_key_user_id_uidx" ON "public"."notifications" USING "btree" ("source_event_key", "user_id") WHERE ("source_event_key" IS NOT NULL);



CREATE UNIQUE INDEX "order_items_order_product_unique" ON "public"."order_items" USING "btree" ("order_id", "product_id");



CREATE UNIQUE INDEX "order_items_shipment_id_unique" ON "public"."order_items" USING "btree" ("shipment_id") WHERE ("shipment_id" IS NOT NULL);



CREATE INDEX "orders_checkout_recovery_claim_idx" ON "public"."orders" USING "btree" ("next_compensation_retry_at", "created_at") WHERE (("payment_processing" = true) AND ("compensation_state" = ANY (ARRAY['refund_pending'::"text", 'refund_failed_retry_queued'::"text", 'refunding'::"text"])));



CREATE UNIQUE INDEX "orders_stripe_payment_intent_id_recovery_uidx" ON "public"."orders" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE UNIQUE INDEX "shipment_tracking_events_deduplication_key" ON "public"."shipment_tracking_events" USING "btree" ("shipment_id", "dispute_id", "raw_status", "event_at", "location") NULLS NOT DISTINCT;



CREATE INDEX "shipment_tracking_events_dispute_timeline" ON "public"."shipment_tracking_events" USING "btree" ("dispute_id", "event_at", "received_at", "id") WHERE ("dispute_id" IS NOT NULL);



CREATE INDEX "shipment_tracking_events_shipment_timeline" ON "public"."shipment_tracking_events" USING "btree" ("shipment_id", "event_at", "received_at", "id");



CREATE INDEX "shipments_label_generation_state_idx" ON "public"."shipments" USING "btree" ("label_generation_state") WHERE ("label_generation_state" = ANY (ARRAY['claimed'::"text", 'orphan_pending'::"text"]));



CREATE INDEX "stripe_fee_reconciliation_jobs_processing_lease_idx" ON "public"."stripe_fee_reconciliation_jobs" USING "btree" ("claim_expires_at", "updated_at", "id") WHERE ("status" = 'processing'::"text");



CREATE INDEX "stripe_fee_reconciliation_jobs_retry_idx" ON "public"."stripe_fee_reconciliation_jobs" USING "btree" ("next_retry_at", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'failed'::"text"]));



CREATE OR REPLACE TRIGGER "notify_dispute_opened" AFTER INSERT ON "public"."disputes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_notify_dispute_opened"();



CREATE OR REPLACE TRIGGER "set_product_in_dispute" AFTER INSERT ON "public"."disputes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_product_in_dispute"();



CREATE OR REPLACE TRIGGER "shipments_origin_snapshot_immutable" BEFORE UPDATE ON "public"."shipments" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"();



CREATE OR REPLACE TRIGGER "tr_after_review_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."fn_trigger_review_changes"();



CREATE OR REPLACE TRIGGER "tr_on_dispute_opened" AFTER INSERT ON "public"."disputes" FOR EACH ROW EXECUTE FUNCTION "public"."fn_on_dispute_opened"();



CREATE OR REPLACE TRIGGER "tr_orders_updated_at" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "tr_product_fts_update" BEFORE INSERT OR UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."fn_update_product_fts"();



CREATE OR REPLACE TRIGGER "trg_connect_account_events_append_only" BEFORE DELETE OR UPDATE ON "public"."connect_account_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_prevent_connect_account_event_mutation"();



CREATE OR REPLACE TRIGGER "trg_connect_payout_events_append_only" BEFORE DELETE OR UPDATE ON "public"."connect_payout_events" FOR EACH ROW EXECUTE FUNCTION "public"."fn_prevent_connect_payout_event_mutation"();



CREATE OR REPLACE TRIGGER "trg_shipments_status" AFTER INSERT OR UPDATE OF "status" ON "public"."shipments" FOR EACH ROW EXECUTE FUNCTION "public"."fn_shipments_status_trigger"();



CREATE OR REPLACE TRIGGER "trigger_check_max_cards" BEFORE INSERT ON "public"."payment_methods" FOR EACH ROW EXECUTE FUNCTION "public"."check_max_payment_methods"();



CREATE OR REPLACE TRIGGER "validate_product_publication_economics" BEFORE INSERT OR UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."validate_product_publication_economics"();



ALTER TABLE ONLY "public"."addresses"
    ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."admin_user_notes"
    ADD CONSTRAINT "admin_user_notes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."admin_user_notes"
    ADD CONSTRAINT "admin_user_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connect_payout_events"
    ADD CONSTRAINT "connect_payout_events_connect_payout_run_id_fkey" FOREIGN KEY ("connect_payout_run_id") REFERENCES "public"."connect_payout_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."connect_payout_run_shipments"
    ADD CONSTRAINT "connect_payout_run_shipments_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."connect_payout_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connect_payout_run_shipments"
    ADD CONSTRAINT "connect_payout_run_shipments_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."connect_payout_runs"
    ADD CONSTRAINT "connect_payout_runs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."connect_payout_runs"
    ADD CONSTRAINT "connect_payout_runs_retry_of_run_id_fkey" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."connect_payout_runs"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."connect_payout_runs"
    ADD CONSTRAINT "connect_payout_runs_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "fk_auth_users" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."seller_bank_accounts"("id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payout_requests"
    ADD CONSTRAINT "payout_requests_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles_private"
    ADD CONSTRAINT "profiles_private_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."seller_bank_accounts"
    ADD CONSTRAINT "seller_bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shipment_cancellation_operations"
    ADD CONSTRAINT "shipment_cancellation_operations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shipment_cancellation_operations"
    ADD CONSTRAINT "shipment_cancellation_operations_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shipment_completion_events"
    ADD CONSTRAINT "shipment_completion_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shipment_completion_events"
    ADD CONSTRAINT "shipment_completion_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shipment_completion_events"
    ADD CONSTRAINT "shipment_completion_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shipment_label_events"
    ADD CONSTRAINT "shipment_label_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id");



ALTER TABLE ONLY "public"."shipment_tracking_events"
    ADD CONSTRAINT "shipment_tracking_events_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id");



ALTER TABLE ONLY "public"."shipment_tracking_events"
    ADD CONSTRAINT "shipment_tracking_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id");



ALTER TABLE ONLY "public"."shipment_tracking_events"
    ADD CONSTRAINT "shipment_tracking_events_webhook_delivery_id_fkey" FOREIGN KEY ("webhook_delivery_id") REFERENCES "public"."webhook_deliveries"("id");



ALTER TABLE ONLY "public"."shipments"
    ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shipments"
    ADD CONSTRAINT "shipments_origin_address_id_fkey" FOREIGN KEY ("origin_address_id") REFERENCES "public"."addresses"("id");



ALTER TABLE ONLY "public"."shipments"
    ADD CONSTRAINT "shipments_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stripe_fee_reconciliation_jobs"
    ADD CONSTRAINT "stripe_fee_reconciliation_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."system_logs"
    ADD CONSTRAINT "system_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id");



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."webhook_dlq"
    ADD CONSTRAINT "webhook_dlq_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE "public"."addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "addresses_delete_policy" ON "public"."addresses" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "addresses_insert_policy" ON "public"."addresses" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "addresses_select_policy" ON "public"."addresses" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "addresses_update_policy" ON "public"."addresses" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."admin_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_audit_logs_read" ON "public"."admin_audit_logs" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "admin_payments_select" ON "public"."payout_requests" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_payments_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_payments_select" ON "public"."seller_bank_accounts" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_payments_update" ON "public"."payout_requests" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."admin_user_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_user_notes_all" ON "public"."admin_user_notes" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "bank_accounts_all" ON "public"."seller_bank_accounts" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."blocked_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blocked_users_all" ON "public"."blocked_users" USING ((( SELECT "auth"."uid"() AS "uid") = "blocker_id"));



CREATE POLICY "category_config_select" ON "public"."category_configurations" FOR SELECT USING (true);



ALTER TABLE "public"."category_configurations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checkout_recovery_shells" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connect_account_actionability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connect_account_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connect_payout_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connect_payout_run_shipments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connect_payout_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."disputes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "disputes_insert" ON "public"."disputes" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "buyer_id"));



CREATE POLICY "disputes_select" ON "public"."disputes" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "buyer_id") OR (( SELECT "auth"."uid"() AS "uid") = "seller_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "disputes_update" ON "public"."disputes" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "buyer_id") OR (( SELECT "auth"."uid"() AS "uid") = "seller_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "dlq_admin_select" ON "public"."webhook_dlq" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."favorites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "favorites_all" ON "public"."favorites" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."mexico_banks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mexico_banks_read" ON "public"."mexico_banks" FOR SELECT USING (true);



ALTER TABLE "public"."mexico_zips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mexico_zips_read" ON "public"."mexico_zips" FOR SELECT USING (true);



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_owner_select" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "notifications_owner_update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_items_select_v4" ON "public"."order_items" FOR SELECT USING ("internal"."fn_check_order_access"("order_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_insert" ON "public"."orders" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "orders_select_v4" ON "public"."orders" FOR SELECT USING ("internal"."fn_check_order_access"("id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."payment_methods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_methods_manage" ON "public"."payment_methods" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."payout_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payouts_select" ON "public"."payout_requests" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_delete_block" ON "public"."products" FOR DELETE USING (false);



CREATE POLICY "products_insert" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "seller_id") AND ("status" = 'PENDING_VERIFICATION'::"public"."product_status_enum") AND ("verified_at" IS NULL) AND ("deleted_at" IS NULL) AND ("reserved_at" IS NULL) AND ("locked_by" IS NULL) AND ("status_before_account_hold" IS NULL) AND ( SELECT "public"."fn_current_account_is_active"() AS "fn_current_account_is_active")));



CREATE POLICY "products_select_admin" ON "public"."products" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "products_select_owner" ON "public"."products" FOR SELECT USING (("seller_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "products_select_public" ON "public"."products" FOR SELECT USING ((("deleted_at" IS NULL) AND ("status" = ANY (ARRAY['VERIFIED'::"public"."product_status_enum", 'SOLD'::"public"."product_status_enum"]))));



CREATE POLICY "products_update_admin" ON "public"."products" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "products_update_owner" ON "public"."products" FOR UPDATE TO "authenticated" USING ((("seller_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("deleted_at" IS NULL) AND ("status" = ANY (ARRAY['PENDING_VERIFICATION'::"public"."product_status_enum", 'VERIFIED'::"public"."product_status_enum", 'HIDDEN'::"public"."product_status_enum", 'REJECTED'::"public"."product_status_enum"])) AND ( SELECT "public"."fn_current_account_is_active"() AS "fn_current_account_is_active"))) WITH CHECK ((("seller_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = ANY (ARRAY['PENDING_VERIFICATION'::"public"."product_status_enum", 'HIDDEN'::"public"."product_status_enum", 'IN_REVIEW'::"public"."product_status_enum"])) AND ("status_before_account_hold" IS NULL) AND ( SELECT "public"."fn_current_account_is_active"() AS "fn_current_account_is_active")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles_private" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_private_access" ON "public"."profiles_private" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "id") OR "public"."is_admin"()));



CREATE POLICY "profiles_public_read" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reports_insert" ON "public"."reports" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "reporter_id"));



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reviews_insert" ON "public"."reviews" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "reviewer_id") AND (EXISTS ( SELECT 1
   FROM "public"."orders"
  WHERE (("orders"."id" = "reviews"."order_id") AND ("orders"."buyer_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "reviews_select" ON "public"."reviews" FOR SELECT USING (true);



ALTER TABLE "public"."seller_bank_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shipment label events are append-only" ON "public"."shipment_label_events" USING (false) WITH CHECK (false);



CREATE POLICY "shipment tracking events are visible to participants and admins" ON "public"."shipment_tracking_events" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM ("public"."shipments" "s"
     JOIN "public"."orders" "o" ON (("o"."id" = "s"."order_id")))
  WHERE (("s"."id" = "shipment_tracking_events"."shipment_id") AND (("o"."buyer_id" = "auth"."uid"()) OR ("s"."seller_id" = "auth"."uid"()))))) OR (EXISTS ( SELECT 1
   FROM "public"."profiles_private" "pp"
  WHERE (("pp"."id" = "auth"."uid"()) AND ("pp"."role" = 'admin'::"text"))))));



ALTER TABLE "public"."shipment_cancellation_operations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shipment_completion_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shipment_label_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shipment_tracking_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shipments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shipments_delete_block" ON "public"."shipments" FOR DELETE USING (false);



CREATE POLICY "shipments_insert_block" ON "public"."shipments" FOR INSERT WITH CHECK (false);



CREATE POLICY "shipments_select_admin" ON "public"."shipments" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "shipments_select_buyer" ON "public"."shipments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "shipments"."order_id") AND ("o"."buyer_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "shipments_select_policy" ON "public"."shipments" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = ( SELECT "orders"."buyer_id"
   FROM "public"."orders"
  WHERE ("orders"."id" = "shipments"."order_id"))) OR (( SELECT "auth"."uid"() AS "uid") = "seller_id") OR "public"."is_admin"()));



CREATE POLICY "shipments_select_seller" ON "public"."shipments" FOR SELECT USING (("seller_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "shipments_update_admin" ON "public"."shipments" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "shipments_update_seller" ON "public"."shipments" FOR UPDATE USING ((("seller_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = ANY (ARRAY['paid'::"public"."order_status_enum", 'preparing'::"public"."order_status_enum", 'shipped'::"public"."order_status_enum"])))) WITH CHECK ((("seller_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = ANY (ARRAY['paid'::"public"."order_status_enum", 'preparing'::"public"."order_status_enum", 'shipped'::"public"."order_status_enum"]))));



ALTER TABLE "public"."stripe_fee_reconciliation_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_logs_insert" ON "public"."system_logs" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "system_logs_read" ON "public"."system_logs" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_settings_read" ON "public"."system_settings" FOR SELECT USING (true);



CREATE POLICY "transactions_select" ON "public"."wallet_transactions" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."wallets"
  WHERE (("wallets"."id" = "wallet_transactions"."wallet_id") AND ("wallets"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ( SELECT "public"."is_admin"() AS "is_admin")));



ALTER TABLE "public"."wallet_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallets_select" ON "public"."wallets" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));



ALTER TABLE "public"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_dlq" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."products";






GRANT USAGE ON SCHEMA "internal" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































































































































































































































REVOKE ALL ON FUNCTION "internal"."fn_check_order_access"("p_order_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "internal"."fn_check_order_access"("p_order_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "internal"."fn_check_order_access"("p_order_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."backfill_product_publication_economics"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backfill_product_publication_economics"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_max_payment_methods"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_max_payment_methods"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_abort_payout_create_to_action_required"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_reason" "text", "p_claim_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_abort_payout_create_to_action_required"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_reason" "text", "p_claim_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_acquire_connect_account_refresh"("p_stripe_account_id" "text", "p_source_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_acquire_connect_account_refresh"("p_stripe_account_id" "text", "p_source_event_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_acquire_track_shipments_lease"("p_lane" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_acquire_track_shipments_lease"("p_lane" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_admin_restore_product"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_admin_restore_product"("p_product_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_admin_restore_product"("p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_admin_soft_delete_product"("p_product_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_admin_soft_delete_product"("p_product_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_admin_soft_delete_product"("p_product_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_admin_toggle_verified_seller"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_is_verified" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_admin_toggle_verified_seller"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_is_verified" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_admin_toggle_verified_seller"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_is_verified" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_admin_update_user_status"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_new_status" "public"."account_status", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_admin_update_user_status"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_new_status" "public"."account_status", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_admin_update_user_status"("p_target_user_id" "uuid", "p_admin_id" "uuid", "p_new_status" "public"."account_status", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_append_connect_payout_event"("p_stripe_event_id" "text", "p_event_type" "text", "p_stripe_payout_id" "text", "p_connect_payout_run_id" "uuid", "p_stripe_created" timestamp with time zone, "p_observed_payout_status" "text", "p_failure_code" "text", "p_failure_message" "text", "p_failure_balance_transaction" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_append_connect_payout_event"("p_stripe_event_id" "text", "p_event_type" "text", "p_stripe_payout_id" "text", "p_connect_payout_run_id" "uuid", "p_stripe_created" timestamp with time zone, "p_observed_payout_status" "text", "p_failure_code" "text", "p_failure_message" "text", "p_failure_balance_transaction" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_apply_connect_account_actionability"("p_stripe_account_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean, "p_external_account_status" "text", "p_source_event_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_apply_connect_account_actionability"("p_stripe_account_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean, "p_external_account_status" "text", "p_source_event_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_atomic_payout_resume_mapping"("p_run_id" "uuid", "p_mode" "text", "p_expected_status" "text", "p_expected_stage" "text", "p_expected_version" integer, "p_shipment_ids" "uuid"[], "p_parent_run_id" "uuid", "p_expected_parent_version" integer, "p_expected_parent_payout_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_atomic_payout_resume_mapping"("p_run_id" "uuid", "p_mode" "text", "p_expected_status" "text", "p_expected_stage" "text", "p_expected_version" integer, "p_shipment_ids" "uuid"[], "p_parent_run_id" "uuid", "p_expected_parent_version" integer, "p_expected_parent_payout_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_begin_manual_payout_create_fence"("p_run_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_begin_manual_payout_create_fence"("p_run_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_begin_payout_create_fence"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_begin_payout_create_fence"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_begin_shipment_transfer"("p_run_id" "uuid", "p_shipment_id" "uuid", "p_expected_stage_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_begin_shipment_transfer"("p_run_id" "uuid", "p_shipment_id" "uuid", "p_expected_stage_version" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_blocked_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_block_payout_run_for_account_actionability"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_blocked_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_buyer_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_buyer_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cancel_order"("p_order_id" "uuid", "p_reason" "text", "p_cancelled_by_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cancel_order"("p_order_id" "uuid", "p_reason" "text", "p_cancelled_by_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cancel_shipment"("p_shipment_id" "uuid", "p_cancelled_by_role" "text", "p_reason" "text", "p_cancellation_loss_cents" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cancel_shipment"("p_shipment_id" "uuid", "p_cancelled_by_role" "text", "p_reason" "text", "p_cancellation_loss_cents" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"("p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_claim_awaiting_balance_payout_run"("p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_claim_checkout_recovery_shells"("p_limit" integer, "p_stripe_payment_intent_id" "text", "p_claim_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_claim_checkout_recovery_shells"("p_limit" integer, "p_stripe_payment_intent_id" "text", "p_claim_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_claim_payout_create_reconciliation"("p_grace_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_claim_payout_create_reconciliation"("p_grace_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_claim_shipment_cancellation"("p_shipment_id" "uuid", "p_order_id" "uuid", "p_actor_id" "uuid", "p_source" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_claim_shipment_cancellation"("p_shipment_id" "uuid", "p_order_id" "uuid", "p_actor_id" "uuid", "p_source" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_claim_shipment_label"("p_shipment_id" "uuid", "p_seller_id" "uuid", "p_origin_address_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_claim_shipment_label"("p_shipment_id" "uuid", "p_seller_id" "uuid", "p_origin_address_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."stripe_fee_reconciliation_jobs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"("p_limit" integer, "p_max_attempts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"("p_limit" integer, "p_max_attempts" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_commit_connect_account_refresh"("p_stripe_account_id" "text", "p_expected_generation" bigint, "p_source_event_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_payouts_enabled" boolean, "p_current_external_account_id" "text", "p_current_external_account_status" "text", "p_current_currency" "text", "p_current_default_for_currency" boolean, "p_mxn_default_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_commit_connect_account_refresh"("p_stripe_account_id" "text", "p_expected_generation" bigint, "p_source_event_id" "text", "p_is_actionable" boolean, "p_blocked_reason" "text", "p_payouts_enabled" boolean, "p_current_external_account_id" "text", "p_current_external_account_status" "text", "p_current_currency" "text", "p_current_default_for_currency" boolean, "p_mxn_default_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_complete_payout_create_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_stripe_payout_id" "text", "p_claim_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_complete_payout_create_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_stripe_payout_id" "text", "p_claim_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_complete_shipment_refund"("p_shipment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_complete_shipment_refund"("p_shipment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_complete_shipment_transfer"("p_run_id" "uuid", "p_shipment_id" "uuid", "p_expected_stage_version" integer, "p_transfer_token" "uuid", "p_stripe_transfer_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_complete_shipment_transfer"("p_run_id" "uuid", "p_shipment_id" "uuid", "p_expected_stage_version" integer, "p_transfer_token" "uuid", "p_stripe_transfer_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"("p_job_id" "uuid", "p_actual_stripe_fee_cents" bigint, "p_reconciled_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"("p_job_id" "uuid", "p_actual_stripe_fee_cents" bigint, "p_reconciled_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job_leased"("p_job_id" "uuid", "p_claim_token" "uuid", "p_actual_stripe_fee_cents" bigint, "p_reconciled_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job_leased"("p_job_id" "uuid", "p_claim_token" "uuid", "p_actual_stripe_fee_cents" bigint, "p_reconciled_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_confirm_shipment_delivery"("p_shipment_id" "uuid", "p_source" "text", "p_actor_id" "uuid", "p_idempotency_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_confirm_shipment_delivery"("p_shipment_id" "uuid", "p_source" "text", "p_actor_id" "uuid", "p_idempotency_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_create_order_from_payment"("p_buyer_id" "uuid", "p_stripe_intent_id" "text", "p_total_amount" numeric, "p_service_fee" numeric, "p_address_id" "uuid", "p_product_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_create_order_from_payment"("p_buyer_id" "uuid", "p_stripe_intent_id" "text", "p_total_amount" numeric, "p_service_fee" numeric, "p_address_id" "uuid", "p_product_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_create_shipment_from_payment"("p_stripe_payment_intent_id" "text", "p_amount_received" bigint, "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_create_shipment_from_payment"("p_stripe_payment_intent_id" "text", "p_amount_received" bigint, "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_create_shipments_from_single_payment"("p_stripe_payment_intent_id" "text", "p_stripe_charge_id" "text", "p_amount_received" bigint, "p_transfer_group" "text", "p_allocation" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_create_shipments_from_single_payment"("p_stripe_payment_intent_id" "text", "p_stripe_charge_id" "text", "p_amount_received" bigint, "p_transfer_group" "text", "p_allocation" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cron_dispute_payout_timeout"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cron_dispute_payout_timeout"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cron_dispute_shipping_timeout"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cron_dispute_shipping_timeout"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cron_release_shipment_funds"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cron_release_shipment_funds"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_cron_return_delivery_timeout"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_cron_return_delivery_timeout"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_current_account_is_active"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_current_account_is_active"() TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_current_account_is_active"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_decide_rejected_payout_stage_park"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text", "p_failure_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_decide_rejected_payout_stage_park"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text", "p_failure_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_defer_awaiting_balance_run"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_backoff_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_defer_awaiting_balance_run"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer, "p_backoff_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_derive_order_status"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_derive_order_status"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_fail_payout_create_from_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_failure_reason" "text", "p_claim_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_fail_payout_create_from_fence"("p_run_id" "uuid", "p_expected_stage_version" integer, "p_failure_reason" "text", "p_claim_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_finalize_checkout_recovery"("p_stripe_payment_intent_id" "text", "p_stripe_refund_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_finalize_checkout_recovery"("p_stripe_payment_intent_id" "text", "p_stripe_refund_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_finalize_shipment_label"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_envia_shipment_id" "text", "p_tracking_number" "text", "p_label_url" "text", "p_carrier" "text", "p_service" "text", "p_print_format" "text", "p_print_size" "text", "p_provider_cost_cents" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_finalize_shipment_label"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_envia_shipment_id" "text", "p_tracking_number" "text", "p_label_url" "text", "p_carrier" "text", "p_service" "text", "p_print_format" "text", "p_print_size" "text", "p_provider_cost_cents" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_get_admin_payout_queue"("p_search" "text", "p_bucket" "text", "p_page" integer, "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_get_admin_payout_queue"("p_search" "text", "p_bucket" "text", "p_page" integer, "p_scope" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_get_connect_account_actionability"("p_stripe_account_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_get_connect_account_actionability"("p_stripe_account_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_get_location_by_zip"("p_zip" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_get_location_by_zip"("p_zip" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_get_location_by_zip"("p_zip" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_get_location_by_zip"("p_zip" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_lock_dispute"("p_dispute_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_lock_dispute"("p_dispute_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_lock_product"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_lock_product"("p_product_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_lock_product"("p_product_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_log_return_payment"("p_dispute_id" "uuid", "p_stripe_id" "text", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_log_return_payment"("p_dispute_id" "uuid", "p_stripe_id" "text", "p_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_checkout_recovery_reconciliation_needed"("p_stripe_payment_intent_id" "text", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_checkout_recovery_reconciliation_needed"("p_stripe_payment_intent_id" "text", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_checkout_recovery_retry"("p_stripe_payment_intent_id" "text", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_checkout_recovery_retry"("p_stripe_payment_intent_id" "text", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"("p_run_id" "uuid", "p_failure_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_payout_run_reconciliation_needed"("p_run_id" "uuid", "p_failure_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_payout_run_sync_failed"("p_run_id" "uuid", "p_stripe_payout_id" "text", "p_failure_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_payout_run_sync_failed"("p_run_id" "uuid", "p_stripe_payout_id" "text", "p_failure_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_return_delivered"("p_dispute_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_return_delivered"("p_dispute_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_shipment_delivered"("p_shipment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_shipment_delivered"("p_shipment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_shipment_label_orphan"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_error_class" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_shipment_label_orphan"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_error_class" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_shipment_label_rejected"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_error_class" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_shipment_label_rejected"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_error_class" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_mark_shipment_label_sent"("p_shipment_id" "uuid", "p_claim_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_mark_shipment_label_sent"("p_shipment_id" "uuid", "p_claim_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_notify_dispute_opened"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_notify_dispute_opened"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_on_auth_user_created"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_on_auth_user_created"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_on_auth_user_updated"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_on_auth_user_updated"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_on_dispute_opened"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_on_dispute_opened"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_persist_shipment_label_quote"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_carrier" "text", "p_service" "text", "p_quote_cost_cents" bigint, "p_quote_reference" "text", "p_input_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_persist_shipment_label_quote"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_carrier" "text", "p_service" "text", "p_quote_cost_cents" bigint, "p_quote_reference" "text", "p_input_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_prevent_connect_account_event_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_prevent_connect_account_event_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_prevent_connect_payout_event_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_prevent_connect_payout_event_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_project_payout_run_stage"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_project_payout_run_stage"("p_run_id" "uuid", "p_payout_id" "text", "p_target_stage" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_project_payout_run_terminal"("p_run_id" "uuid", "p_payout_id" "text", "p_target_status" "text", "p_occurred_at" timestamp with time zone, "p_failure_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_project_payout_run_terminal"("p_run_id" "uuid", "p_payout_id" "text", "p_target_status" "text", "p_occurred_at" timestamp with time zone, "p_failure_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_reconcile_connect_payments"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_reconcile_connect_payments"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_reconcile_shipment_label"("p_shipment_id" "uuid", "p_actor_id" "uuid", "p_envia_shipment_id" "text", "p_tracking_number" "text", "p_label_url" "text", "p_carrier" "text", "p_service" "text", "p_print_format" "text", "p_print_size" "text", "p_provider_cost_cents" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_reconcile_shipment_label"("p_shipment_id" "uuid", "p_actor_id" "uuid", "p_envia_shipment_id" "text", "p_tracking_number" "text", "p_label_url" "text", "p_carrier" "text", "p_service" "text", "p_print_format" "text", "p_print_size" "text", "p_provider_cost_cents" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_record_connect_account_event"("p_stripe_event_id" "text", "p_stripe_account_id" "text", "p_event_type" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean, "p_external_account_status" "text", "p_external_account_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_record_connect_account_event"("p_stripe_event_id" "text", "p_stripe_account_id" "text", "p_event_type" "text", "p_stripe_created" timestamp with time zone, "p_payouts_enabled" boolean, "p_external_account_status" "text", "p_external_account_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_record_tracking_event"("p_shipment_id" "uuid", "p_dispute_id" "uuid", "p_event_type" "public"."shipment_tracking_event_type", "p_event_at" timestamp with time zone, "p_raw_status" "text", "p_location" "text", "p_status_description" "text", "p_carrier_name" "text", "p_webhook_delivery_id" "uuid", "p_polling_run_id" "uuid", "p_transition" "public"."order_status_enum") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_record_tracking_event"("p_shipment_id" "uuid", "p_dispute_id" "uuid", "p_event_type" "public"."shipment_tracking_event_type", "p_event_at" timestamp with time zone, "p_raw_status" "text", "p_location" "text", "p_status_description" "text", "p_carrier_name" "text", "p_webhook_delivery_id" "uuid", "p_polling_run_id" "uuid", "p_transition" "public"."order_status_enum") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_refresh_seller_stats"("p_seller_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_refresh_seller_stats"("p_seller_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_release_payout_claim"("p_run_id" "uuid", "p_claim_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_release_payout_claim"("p_run_id" "uuid", "p_claim_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_release_products"("p_product_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_release_products"("p_product_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_release_products"("p_product_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_release_shipment_funds"("p_shipment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_release_shipment_funds"("p_shipment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_release_stale_reservations"("p_product_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_release_stale_reservations"("p_product_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_release_track_shipments_lease"("p_lane" "text", "p_lease_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_release_track_shipments_lease"("p_lane" "text", "p_lease_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_request_payout"("p_amount" numeric, "p_bank_account_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_request_payout"("p_amount" numeric, "p_bank_account_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_request_payout"("p_amount" numeric, "p_bank_account_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_reserve_products"("p_buyer_id" "uuid", "p_product_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_reserve_products"("p_buyer_id" "uuid", "p_product_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_resolve_dispute_to_buyer"("p_dispute_id" "uuid", "p_admin_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_resolve_dispute_to_buyer"("p_dispute_id" "uuid", "p_admin_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_resolve_dispute_to_buyer_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_resolve_dispute_to_buyer_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_resolve_dispute_to_seller"("p_dispute_id" "uuid", "p_admin_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_resolve_dispute_to_seller"("p_dispute_id" "uuid", "p_admin_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_resolve_dispute_to_seller_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_resolve_dispute_to_seller_as_admin"("p_dispute_id" "uuid", "p_admin_note" "text", "p_admin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_resolve_product_verdict"("p_product_id" "uuid", "p_verdict" "text", "p_public_note" "text", "p_private_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_resolve_product_verdict"("p_product_id" "uuid", "p_verdict" "text", "p_public_note" "text", "p_private_note" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_resolve_product_verdict"("p_product_id" "uuid", "p_verdict" "text", "p_public_note" "text", "p_private_note" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_save_bank_account"("p_clabe" "text", "p_holder_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_save_bank_account"("p_clabe" "text", "p_holder_name" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_save_bank_account"("p_clabe" "text", "p_holder_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_seller_confirm_return_shipment"("p_shipment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_seller_confirm_return_shipment"("p_shipment_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_seller_confirm_return_shipment"("p_shipment_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_seller_initiate_return_label"("p_dispute_id" "uuid", "p_caller_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_seller_initiate_return_label"("p_dispute_id" "uuid", "p_caller_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_seller_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[], "p_video_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_seller_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[], "p_video_url" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."fn_seller_submit_return_evidence"("p_dispute_id" "uuid", "p_images" "text"[], "p_video_url" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fn_set_checkout_recovery_charge_evidence"("p_stripe_payment_intent_id" "text", "p_stripe_charge_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_set_checkout_recovery_charge_evidence"("p_stripe_payment_intent_id" "text", "p_stripe_charge_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_set_product_in_dispute"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_set_product_in_dispute"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_shipments_status_trigger"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_start_shipment_cancellation"("p_shipment_id" "uuid", "p_claim_token" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."fn_start_shipment_cancellation_refund"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_refund_request" "jsonb", "p_cancellation_loss_cents" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_start_shipment_cancellation_refund"("p_shipment_id" "uuid", "p_claim_token" "uuid", "p_refund_request" "jsonb", "p_cancellation_loss_cents" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_transition_payout_release_stage"("p_run_id" "uuid", "p_target_stage" "text", "p_expected_stage_version" integer, "p_claim_token" "text", "p_last_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_transition_payout_release_stage"("p_run_id" "uuid", "p_target_stage" "text", "p_expected_stage_version" integer, "p_claim_token" "text", "p_last_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"("p_job_id" "uuid", "p_outcome" "text", "p_next_retry_at" timestamp with time zone, "p_last_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"("p_job_id" "uuid", "p_outcome" "text", "p_next_retry_at" timestamp with time zone, "p_last_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job_leased"("p_job_id" "uuid", "p_claim_token" "uuid", "p_outcome" "text", "p_next_retry_at" timestamp with time zone, "p_last_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job_leased"("p_job_id" "uuid", "p_claim_token" "uuid", "p_outcome" "text", "p_next_retry_at" timestamp with time zone, "p_last_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_trigger_review_changes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_trigger_review_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_unlock_dispute"("p_dispute_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_unlock_dispute"("p_dispute_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_unlock_product"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_unlock_product"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_update_product_fts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_update_product_fts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_upsert_checkout_recovery_shell"("p_stripe_payment_intent_id" "text", "p_reason" "text", "p_source_metadata" "jsonb", "p_charged_amount_cents" bigint, "p_stripe_charge_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_upsert_checkout_recovery_shell"("p_stripe_payment_intent_id" "text", "p_reason" "text", "p_source_metadata" "jsonb", "p_charged_amount_cents" bigint, "p_stripe_charge_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_verify_payout_claim"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_verify_payout_claim"("p_run_id" "uuid", "p_claim_token" "text", "p_expected_stage_version" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_profile_stats"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_profile_stats"("target_user_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_profile_stats"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_profile_stats"("target_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_sync_user_data"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_sync_user_data"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_sync_user_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_sync_user_email"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_update_user_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_update_user_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."normalize_publication_rate"("p_rate" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_publication_rate"("p_rate" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_shipment_origin_snapshot_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_updated_at_column"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_product_publication_economics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_product_publication_economics"() TO "service_role";

































GRANT ALL ON TABLE "public"."addresses" TO "anon";
GRANT ALL ON TABLE "public"."addresses" TO "authenticated";
GRANT ALL ON TABLE "public"."addresses" TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT UPDATE("username") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("updated_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."shipments" TO "anon";
GRANT ALL ON TABLE "public"."shipments" TO "authenticated";
GRANT ALL ON TABLE "public"."shipments" TO "service_role";



GRANT ALL ON TABLE "public"."admin_connect_earnings_view" TO "anon";
GRANT ALL ON TABLE "public"."admin_connect_earnings_view" TO "service_role";



GRANT ALL ON TABLE "public"."connect_payout_run_shipments" TO "service_role";



GRANT ALL ON TABLE "public"."connect_payout_runs" TO "service_role";



GRANT ALL ON TABLE "public"."disputes" TO "anon";
GRANT ALL ON TABLE "public"."disputes" TO "authenticated";
GRANT ALL ON TABLE "public"."disputes" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."profiles_private" TO "anon";
GRANT ALL ON TABLE "public"."profiles_private" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles_private" TO "service_role";



GRANT ALL ON TABLE "public"."admin_connect_payout_release_view" TO "service_role";



GRANT ALL ON TABLE "public"."admin_disputes_monitor_view" TO "anon";
GRANT ALL ON TABLE "public"."admin_disputes_monitor_view" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_disputes_monitor_view" TO "service_role";



GRANT ALL ON TABLE "public"."payout_requests" TO "anon";
GRANT ALL ON TABLE "public"."payout_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_requests" TO "service_role";



GRANT ALL ON TABLE "public"."seller_bank_accounts" TO "anon";
GRANT ALL ON TABLE "public"."seller_bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."seller_bank_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."admin_payments_overview" TO "anon";
GRANT ALL ON TABLE "public"."admin_payments_overview" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_payments_overview" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."admin_product_queue_view" TO "anon";
GRANT ALL ON TABLE "public"."admin_product_queue_view" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_product_queue_view" TO "service_role";



GRANT ALL ON TABLE "public"."admin_seller_onboarding_view" TO "anon";
GRANT ALL ON TABLE "public"."admin_seller_onboarding_view" TO "service_role";



GRANT ALL ON TABLE "public"."wallets" TO "anon";
GRANT ALL ON TABLE "public"."wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."wallets" TO "service_role";



GRANT ALL ON TABLE "public"."admin_user_directory_view" TO "anon";
GRANT ALL ON TABLE "public"."admin_user_directory_view" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_user_directory_view" TO "service_role";



GRANT ALL ON TABLE "public"."admin_user_notes" TO "anon";
GRANT ALL ON TABLE "public"."admin_user_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_user_notes" TO "service_role";



GRANT ALL ON TABLE "public"."blocked_users" TO "anon";
GRANT ALL ON TABLE "public"."blocked_users" TO "authenticated";
GRANT ALL ON TABLE "public"."blocked_users" TO "service_role";



GRANT ALL ON TABLE "public"."category_configurations" TO "anon";
GRANT ALL ON TABLE "public"."category_configurations" TO "authenticated";
GRANT ALL ON TABLE "public"."category_configurations" TO "service_role";



GRANT ALL ON TABLE "public"."checkout_recovery_shells" TO "service_role";



GRANT ALL ON TABLE "public"."favorites" TO "anon";
GRANT ALL ON TABLE "public"."favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."favorites" TO "service_role";



GRANT ALL ON TABLE "public"."mexico_banks" TO "anon";
GRANT ALL ON TABLE "public"."mexico_banks" TO "authenticated";
GRANT ALL ON TABLE "public"."mexico_banks" TO "service_role";



GRANT ALL ON TABLE "public"."mexico_zips" TO "anon";
GRANT ALL ON TABLE "public"."mexico_zips" TO "authenticated";
GRANT ALL ON TABLE "public"."mexico_zips" TO "service_role";



GRANT ALL ON SEQUENCE "public"."mexico_zips_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."mexico_zips_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."mexico_zips_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "service_role";
GRANT SELECT ON TABLE "public"."notifications" TO "authenticated";



GRANT UPDATE("read") ON TABLE "public"."notifications" TO "authenticated";



GRANT UPDATE("deleted_at") ON TABLE "public"."notifications" TO "authenticated";



GRANT ALL ON TABLE "public"."payment_methods" TO "anon";
GRANT ALL ON TABLE "public"."payment_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_methods" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."seller_trust_stats" TO "anon";
GRANT ALL ON TABLE "public"."seller_trust_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."seller_trust_stats" TO "service_role";



GRANT ALL ON TABLE "public"."shipment_completion_events" TO "service_role";



GRANT ALL ON TABLE "public"."shipment_label_events" TO "anon";
GRANT ALL ON TABLE "public"."shipment_label_events" TO "authenticated";
GRANT ALL ON TABLE "public"."shipment_label_events" TO "service_role";



GRANT ALL ON TABLE "public"."shipment_tracking_events" TO "service_role";
GRANT SELECT ON TABLE "public"."shipment_tracking_events" TO "authenticated";



GRANT ALL ON TABLE "public"."system_logs" TO "anon";
GRANT ALL ON TABLE "public"."system_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."system_logs" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_dlq" TO "anon";
GRANT ALL ON TABLE "public"."webhook_dlq" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_dlq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































