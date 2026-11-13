-- Move the two money-path machinery tables from public to internal
-- (odd/tasks/internal-schema.md S3, S10, T6): checkout_recovery_shells (the
-- refund queue for checkout payments without an order) and
-- stripe_fee_reconciliation_jobs (the Stripe fee recovery ledger).
-- ALTER TABLE ... SET SCHEMA keeps their rows, indexes, constraints, column
-- comments, RLS and the foreign key stripe_fee_reconciliation_jobs.order_id ->
-- public.orders(id) ON DELETE RESTRICT. The SQL functions that read or write
-- them now name internal.<table>; their bodies are otherwise unchanged:
-- fn_upsert_checkout_recovery_shell, fn_set_checkout_recovery_charge_evidence,
-- fn_claim_checkout_recovery_shells, fn_mark_checkout_recovery_retry,
-- fn_mark_checkout_recovery_reconciliation_needed, fn_finalize_checkout_recovery,
-- fn_transition_stripe_fee_reconciliation_job_leased and
-- fn_complete_stripe_fee_reconciliation_job_leased.
-- fn_claim_stripe_fee_reconciliation_jobs_leased returned SETOF the moved row
-- type; it now returns TABLE(...) with the same columns in the same order (same
-- JSON for PostgREST). A return type cannot change in place, so it is dropped
-- and created again; its column references now name the table alias because the
-- output columns share the table's column names.
-- New RPC fn_enqueue_stripe_fee_reconciliation_job(order_id, payment_intent_id)
-- replaces the direct upsert in the stripe-webhooks Edge Function: it inserts a
-- pending job due now (attempt_count 0, no error) or, when the pair already has
-- one, does nothing; it returns true when it inserted.
-- Dropped: fn_claim_stripe_fee_reconciliation_jobs(integer),
-- fn_complete_stripe_fee_reconciliation_job(uuid, bigint, timestamptz) and
-- fn_transition_stripe_fee_reconciliation_job(uuid, text, timestamptz, text),
-- which only raised STRIPE_FEE_LEASE_REQUIRED (maintainer approval, L20).
-- Grant review: no role but the owner keeps a privilege on the two tables.
-- service_role loses its grants on both (anon and authenticated had none):
-- every SQL path to them is SECURITY DEFINER. The new RPC is SECURITY DEFINER
-- with search_path '', requires the service_role claim in its body (UNAUTHORIZED,
-- 42501, like the other fee functions) and grants EXECUTE to service_role only;
-- the re-created claim keeps SECURITY DEFINER, search_path public, pg_temp, its
-- guard and EXECUTE for service_role only. PUBLIC, anon and authenticated get
-- nothing, and they have no USAGE on schema internal.
SET local check_function_bodies = off;

DROP FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs"(integer);

DROP FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer);

DROP FUNCTION "public"."fn_complete_stripe_fee_reconciliation_job"(uuid, bigint, timestamp WITH time zone);

DROP FUNCTION "public"."fn_transition_stripe_fee_reconciliation_job"(uuid, text, timestamp WITH time zone, text);

ALTER TABLE "public"."checkout_recovery_shells" SET SCHEMA "internal";

ALTER TABLE "public"."stripe_fee_reconciliation_jobs" SET SCHEMA "internal";

REVOKE ALL ON TABLE "internal"."checkout_recovery_shells" FROM "service_role";

REVOKE ALL ON TABLE "internal"."stripe_fee_reconciliation_jobs" FROM "service_role";

CREATE OR REPLACE FUNCTION public.fn_claim_checkout_recovery_shells (
  p_limit                    integer DEFAULT 25,
  p_stripe_payment_intent_id text    DEFAULT NULL::text,
  p_claim_scope              text    DEFAULT NULL::text
)
  RETURNS TABLE (
    stripe_payment_intent_id text,
    stripe_charge_id         text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
    FROM internal.checkout_recovery_shells s
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
  UPDATE internal.checkout_recovery_shells s
  SET compensation_state = 'refunding',
      compensation_attempt_count = s.compensation_attempt_count + 1,
      compensation_lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  FROM eligible
  WHERE s.stripe_payment_intent_id = eligible.stripe_payment_intent_id
  RETURNING s.stripe_payment_intent_id, s.stripe_charge_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_claim_stripe_fee_reconciliation_jobs_leased (
  p_limit        integer DEFAULT 25,
  p_max_attempts integer DEFAULT 3
)
  RETURNS TABLE (
    id                       uuid,
    order_id                 uuid,
    stripe_payment_intent_id text,
    status                   text,
    attempt_count            integer,
    next_retry_at            timestamp with time zone,
    last_error               text,
    created_at               timestamp with time zone,
    updated_at               timestamp with time zone,
    claim_token              uuid,
    claim_expires_at         timestamp with time zone
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_job internal.stripe_fee_reconciliation_jobs;
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
    FROM internal.stripe_fee_reconciliation_jobs AS job
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
      UPDATE internal.stripe_fee_reconciliation_jobs AS job
      SET status = 'failed', claim_token = NULL, claim_expires_at = NULL,
          next_retry_at = NULL, last_error = 'STRIPE_FEE_ATTEMPTS_EXHAUSTED',
          updated_at = clock_timestamp()
      WHERE job.id = v_job.id;
    ELSE
      -- The output columns share the table's column names, so every column
      -- reference names its table alias.
      UPDATE internal.stripe_fee_reconciliation_jobs AS job
      SET status = 'processing', attempt_count = job.attempt_count + 1,
          claim_token = gen_random_uuid(),
          claim_expires_at = clock_timestamp() + INTERVAL '5 minutes',
          next_retry_at = NULL, updated_at = clock_timestamp()
      WHERE job.id = v_job.id
      RETURNING job.* INTO v_job;
      RETURN QUERY SELECT v_job.id, v_job.order_id, v_job.stripe_payment_intent_id,
        v_job.status, v_job.attempt_count, v_job.next_retry_at, v_job.last_error,
        v_job.created_at, v_job.updated_at, v_job.claim_token, v_job.claim_expires_at;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.fn_complete_stripe_fee_reconciliation_job_leased (
  p_job_id                  uuid,
  p_claim_token             uuid,
  p_actual_stripe_fee_cents bigint,
  p_reconciled_at           timestamp with time zone
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_job internal.stripe_fee_reconciliation_jobs;
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

  SELECT * INTO v_job FROM internal.stripe_fee_reconciliation_jobs
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

  UPDATE internal.stripe_fee_reconciliation_jobs
  SET status = 'succeeded', next_retry_at = NULL, last_error = NULL,
      claim_expires_at = NULL, updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_stripe_fee_reconciliation_job (
  p_order_id                 uuid,
  p_stripe_payment_intent_id text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO internal.stripe_fee_reconciliation_jobs AS j (
    order_id, stripe_payment_intent_id, status, attempt_count, next_retry_at, last_error, updated_at
  )
  VALUES (p_order_id, p_stripe_payment_intent_id, 'pending', 0, now(), NULL, now())
  ON CONFLICT (order_id, stripe_payment_intent_id) DO NOTHING
  RETURNING j.id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) FROM PUBLIC, "anon", "authenticated";

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
    AND p.status = 'RESERVED'
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

CREATE OR REPLACE FUNCTION public.fn_mark_checkout_recovery_reconciliation_needed (
  p_stripe_payment_intent_id text,
  p_error                    text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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

  UPDATE internal.checkout_recovery_shells
  SET compensation_state = 'reconciliation_needed',
      compensation_last_error = p_error,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = NULL,
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND compensation_state <> 'refunded';
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_mark_checkout_recovery_retry (
  p_stripe_payment_intent_id text,
  p_error                    text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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

  UPDATE internal.checkout_recovery_shells
  SET compensation_state = 'refund_failed_retry_queued',
      compensation_last_error = p_error,
      compensation_lease_expires_at = NULL,
      next_compensation_retry_at = now() + interval '5 minutes',
      updated_at = now()
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    AND compensation_state <> 'refunded';
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_set_checkout_recovery_charge_evidence (
  p_stripe_payment_intent_id text,
  p_stripe_charge_id         text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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

  UPDATE internal.checkout_recovery_shells
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_transition_stripe_fee_reconciliation_job_leased (
  p_job_id        uuid,
  p_claim_token   uuid,
  p_outcome       text,
  p_next_retry_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_last_error    text                     DEFAULT NULL::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_job internal.stripe_fee_reconciliation_jobs;
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

  SELECT * INTO v_job FROM internal.stripe_fee_reconciliation_jobs
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

  UPDATE internal.stripe_fee_reconciliation_jobs
  SET status = CASE p_outcome WHEN 'retry' THEN 'pending' ELSE 'failed' END,
      next_retry_at = p_next_retry_at, last_error = p_last_error,
      claim_token = NULL, claim_expires_at = NULL, updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_upsert_checkout_recovery_shell (
  p_stripe_payment_intent_id text,
  p_reason                   text,
  p_source_metadata          jsonb,
  p_charged_amount_cents     bigint,
  p_stripe_charge_id         text   DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
    UPDATE internal.checkout_recovery_shells
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

  INSERT INTO internal.checkout_recovery_shells (
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
        internal.checkout_recovery_shells.charged_amount_cents,
        EXCLUDED.charged_amount_cents
      ),
      -- Charge evidence is immutable once observed; retries cannot replace it.
      stripe_charge_id = COALESCE(internal.checkout_recovery_shells.stripe_charge_id, EXCLUDED.stripe_charge_id),
      updated_at = now()
  WHERE internal.checkout_recovery_shells.compensation_state <> 'refunded'
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
$function$;

COMMENT ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) IS 'Service-only (SECURITY DEFINER): queues a pending Stripe fee reconciliation job for an order and payment intent, due now. Returns true when it inserted the job and false when one already exists for the pair, which it leaves unchanged.';

COMMENT ON TABLE "internal"."checkout_recovery_shells" IS 'Refund queue for checkout payments that have no order to settle against, one row per payment intent. Only fn_upsert_checkout_recovery_shell, fn_set_checkout_recovery_charge_evidence, fn_claim_checkout_recovery_shells, fn_mark_checkout_recovery_retry, fn_mark_checkout_recovery_reconciliation_needed and fn_finalize_checkout_recovery (SECURITY DEFINER) reach it.';

COMMENT ON TABLE "internal"."stripe_fee_reconciliation_jobs" IS 'Server-only recovery ledger for reconciling actual Stripe processing fees against paid orders. Only fn_enqueue_stripe_fee_reconciliation_job, fn_claim_stripe_fee_reconciliation_jobs_leased, fn_transition_stripe_fee_reconciliation_job_leased and fn_complete_stripe_fee_reconciliation_job_leased (SECURITY DEFINER) reach it.';

REVOKE ALL ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_claim_stripe_fee_reconciliation_jobs_leased"(integer, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_enqueue_stripe_fee_reconciliation_job"(uuid, text) TO "service_role";
