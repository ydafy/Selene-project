-- Canonical definition of public.fn_record_push_receipts.
-- Service role only (dispatch-push). Records the Expo push receipts of sent
-- deliveries: [{ id, receipt: 'ok' | 'error' | 'missing', error?, token_dead? }].
-- 'missing' means Expo had no receipt for the ticket yet; the row stays due and
-- becomes 'missing' one hour after sending (Expo clears receipts after 24 hours).
-- token_dead (DeviceNotRegistered) disables the token, unless the device
-- registered it again after this push was sent.
-- Migration: supabase/migrations/20261030025554_push_receipts_and_purge.sql

CREATE OR REPLACE FUNCTION public.fn_record_push_receipts(p_receipts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_id uuid;
  v_receipt text;
  v_error text;
  v_token_dead boolean;
  v_status text;
  v_token_id uuid;
  v_sent_at timestamptz;
  v_ok integer := 0;
  v_error_count integer := 0;
  v_missing integer := 0;
  v_pending integer := 0;
  v_ignored integer := 0;
  v_tokens_disabled integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_receipts IS NULL OR jsonb_typeof(p_receipts) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_PUSH_RECEIPTS: expected a JSON array';
  END IF;

  -- Validate the whole batch before touching any row.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_receipts) LOOP
    BEGIN
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'not an object';
      END IF;
      IF v_item->>'id' IS NULL THEN
        RAISE EXCEPTION 'id is required';
      END IF;
      PERFORM (v_item->>'id')::uuid;
      IF v_item->>'receipt' IS NULL OR v_item->>'receipt' NOT IN ('ok', 'error', 'missing') THEN
        RAISE EXCEPTION 'receipt must be ok, error or missing';
      END IF;
      IF v_item ? 'token_dead' AND jsonb_typeof(v_item->'token_dead') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'token_dead must be a boolean';
      END IF;
      IF COALESCE((v_item->>'token_dead')::boolean, false) AND v_item->>'receipt' <> 'error' THEN
        RAISE EXCEPTION 'token_dead requires receipt error';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'INVALID_PUSH_RECEIPTS: % (item %)', SQLERRM, left(v_item::text, 200);
    END;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_receipts) LOOP
    v_id := (v_item->>'id')::uuid;
    v_receipt := v_item->>'receipt';
    v_error := left(v_item->>'error', 500);
    v_token_dead := COALESCE((v_item->>'token_dead')::boolean, false);

    UPDATE public.push_deliveries d SET
      receipt_status = CASE
        WHEN v_receipt <> 'missing' THEN v_receipt
        WHEN d.sent_at <= now() - interval '1 hour' THEN 'missing'
      END,
      receipt_error = CASE WHEN v_receipt = 'error' THEN v_error END,
      receipt_checked_at = now(),
      updated_at = now()
    WHERE d.id = v_id AND d.status = 'sent' AND d.receipt_status IS NULL
    RETURNING d.receipt_status, d.push_token_id, d.sent_at INTO v_status, v_token_id, v_sent_at;

    IF NOT FOUND THEN
      v_ignored := v_ignored + 1;
    ELSIF v_status = 'ok' THEN
      v_ok := v_ok + 1;
    ELSIF v_status = 'error' THEN
      v_error_count := v_error_count + 1;
    ELSIF v_status = 'missing' THEN
      v_missing := v_missing + 1;
    ELSE
      v_pending := v_pending + 1;
    END IF;

    IF FOUND AND v_token_dead THEN
      UPDATE public.push_tokens t
      SET disabled_at = now(), disabled_reason = COALESCE(v_error, 'DeviceNotRegistered'), updated_at = now()
      WHERE t.id = v_token_id AND t.disabled_at IS NULL AND t.updated_at <= v_sent_at;
      IF FOUND THEN
        v_tokens_disabled := v_tokens_disabled + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'error', v_error_count,
    'missing', v_missing,
    'pending', v_pending,
    'ignored', v_ignored,
    'tokens_disabled', v_tokens_disabled
  );
END;
$$;
