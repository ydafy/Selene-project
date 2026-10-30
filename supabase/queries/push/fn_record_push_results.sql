-- =========================================================================
-- fn_record_push_results — the dispatcher records send outcomes (service role only)
-- Migration: supabase/migrations/*_push_outbox.sql
-- p_results is a JSON array of {id, claim_token, outcome, ticket_id?, error?,
-- token_dead?} with outcome sent | retry | failed. The whole batch is validated
-- first; a malformed item raises INVALID_PUSH_RESULTS and nothing changes.
-- A row is updated only while status is sending and the claim_token matches, so
-- a stale or repeated result is ignored. retry reschedules with backoff
-- (1, 5, 15 minutes) and becomes failed after 5 attempts. token_dead (only with
-- failed) also disables the push token. Returns counts per outcome.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_record_push_results(p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_id uuid;
  v_claim_token uuid;
  v_outcome text;
  v_ticket_id text;
  v_error text;
  v_token_dead boolean;
  v_row public.push_deliveries%ROWTYPE;
  v_sent integer := 0;
  v_retry integer := 0;
  v_failed integer := 0;
  v_ignored integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_results IS NULL OR jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_PUSH_RESULTS: expected a JSON array';
  END IF;

  -- Validate the whole batch before touching any row.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    BEGIN
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'not an object';
      END IF;
      IF v_item->>'id' IS NULL OR v_item->>'claim_token' IS NULL THEN
        RAISE EXCEPTION 'id and claim_token are required';
      END IF;
      PERFORM (v_item->>'id')::uuid, (v_item->>'claim_token')::uuid;
      IF v_item->>'outcome' IS NULL OR v_item->>'outcome' NOT IN ('sent', 'retry', 'failed') THEN
        RAISE EXCEPTION 'outcome must be sent, retry or failed';
      END IF;
      IF v_item->>'outcome' = 'sent' AND (v_item->>'ticket_id') IS NULL THEN
        RAISE EXCEPTION 'sent requires ticket_id';
      END IF;
      IF v_item ? 'token_dead' AND jsonb_typeof(v_item->'token_dead') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'token_dead must be a boolean';
      END IF;
      IF COALESCE((v_item->>'token_dead')::boolean, false) AND v_item->>'outcome' <> 'failed' THEN
        RAISE EXCEPTION 'token_dead requires outcome failed';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'INVALID_PUSH_RESULTS: % (item %)', SQLERRM, left(v_item::text, 200);
    END;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    v_id := (v_item->>'id')::uuid;
    v_claim_token := (v_item->>'claim_token')::uuid;
    v_outcome := v_item->>'outcome';
    v_ticket_id := v_item->>'ticket_id';
    v_error := left(v_item->>'error', 500);
    v_token_dead := COALESCE((v_item->>'token_dead')::boolean, false);

    IF v_outcome = 'sent' THEN
      UPDATE public.push_deliveries d SET
        status = 'sent', expo_ticket_id = v_ticket_id, sent_at = now(),
        claim_token = NULL, claimed_at = NULL, updated_at = now()
      WHERE d.id = v_id AND d.claim_token = v_claim_token AND d.status = 'sending'
      RETURNING * INTO v_row;
    ELSIF v_outcome = 'retry' THEN
      UPDATE public.push_deliveries d SET
        status = CASE WHEN d.attempts >= 5 THEN 'failed' ELSE 'pending' END,
        next_attempt_at = now() + CASE d.attempts
          WHEN 1 THEN interval '1 minute'
          WHEN 2 THEN interval '5 minutes'
          ELSE interval '15 minutes'
        END,
        last_error = v_error, claim_token = NULL, claimed_at = NULL, updated_at = now()
      WHERE d.id = v_id AND d.claim_token = v_claim_token AND d.status = 'sending'
      RETURNING * INTO v_row;
    ELSE
      UPDATE public.push_deliveries d SET
        status = 'failed', last_error = v_error,
        claim_token = NULL, claimed_at = NULL, updated_at = now()
      WHERE d.id = v_id AND d.claim_token = v_claim_token AND d.status = 'sending'
      RETURNING * INTO v_row;
    END IF;

    IF NOT FOUND THEN
      v_ignored := v_ignored + 1;
    ELSE
      IF v_row.status = 'sent' THEN
        v_sent := v_sent + 1;
      ELSIF v_row.status = 'pending' THEN
        v_retry := v_retry + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;

      IF v_token_dead THEN
        UPDATE public.push_tokens
        SET disabled_at = now(), disabled_reason = COALESCE(v_error, 'DeviceNotRegistered'), updated_at = now()
        WHERE id = v_row.push_token_id AND disabled_at IS NULL;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sent', v_sent, 'retry', v_retry, 'failed', v_failed, 'ignored', v_ignored);
END;
$$;
