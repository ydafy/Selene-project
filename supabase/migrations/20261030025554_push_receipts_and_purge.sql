-- ============================================================================
-- Push receipts and purge (expo-push-notifications T3).
--
-- Why: dispatch-push sends the claimed deliveries to the Expo Push API and stores
-- each ticket through fn_record_push_results (B1.2). A ticket only says Expo
-- accepted the message; the receipt, available about 15 minutes later and kept
-- for 24 hours, says whether FCM or APNs took it. A DeviceNotRegistered receipt
-- means the device can no longer receive pushes, so its token is disabled. The
-- receipt columns record that check, and finished rows are purged after 30 days
-- so the outbox does not grow without bound.
--
-- Table access does not change: push_deliveries stays closed to client roles.
--
-- Grant review (AGENTS.md):
-- * fn_list_push_receipts_due, fn_record_push_receipts and
--   fn_purge_push_deliveries are SECURITY DEFINER, check
--   auth.role() = 'service_role', and have EXECUTE revoked from PUBLIC, anon and
--   authenticated and granted to service_role only. Only dispatch-push calls
--   them; they read push tickets, disable device tokens and delete rows.
--
-- Canonical definitions: supabase/queries/push/fn_list_push_receipts_due.sql,
-- fn_record_push_receipts.sql and fn_purge_push_deliveries.sql
-- ============================================================================

ALTER TABLE public.push_deliveries
  ADD COLUMN receipt_status text CHECK (receipt_status IN ('ok', 'error', 'missing')),
  ADD COLUMN receipt_error text,
  ADD COLUMN receipt_checked_at timestamptz;

COMMENT ON COLUMN public.push_deliveries.receipt_status IS
  'Expo push receipt of a sent delivery: ok, error (receipt_error holds the code) or missing (no receipt one hour after sending). NULL while the check is due.';

-- The receipt check scans only sent rows without a receipt.
CREATE INDEX push_deliveries_receipt_due_idx ON public.push_deliveries (sent_at)
  WHERE status = 'sent' AND receipt_status IS NULL;
-- The purge scans only finished rows.
CREATE INDEX push_deliveries_purge_idx ON public.push_deliveries (updated_at)
  WHERE status IN ('sent', 'failed', 'skipped');

CREATE OR REPLACE FUNCTION public.fn_list_push_receipts_due(p_limit integer)
RETURNS TABLE (
  delivery_id uuid,
  ticket_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Expo accepts at most 1000 receipt ids per request.
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'INVALID_PUSH_RECEIPT_LIMIT';
  END IF;

  RETURN QUERY
  SELECT d.id, d.expo_ticket_id
  FROM public.push_deliveries d
  WHERE d.status = 'sent'
    AND d.receipt_status IS NULL
    AND d.expo_ticket_id IS NOT NULL
    AND d.sent_at <= now() - interval '15 minutes'
    AND (d.receipt_checked_at IS NULL OR d.receipt_checked_at <= now() - interval '15 minutes')
  ORDER BY d.receipt_checked_at NULLS FIRST, d.sent_at
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_list_push_receipts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_push_receipts_due(integer) TO service_role;

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

REVOKE EXECUTE ON FUNCTION public.fn_record_push_receipts(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_push_receipts(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_purge_push_deliveries(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'INVALID_PUSH_PURGE_LIMIT';
  END IF;

  WITH doomed AS (
    SELECT d.id
    FROM public.push_deliveries d
    WHERE d.status IN ('sent', 'failed', 'skipped')
      AND d.updated_at < now() - interval '30 days'
    ORDER BY d.updated_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.push_deliveries d
  USING doomed
  WHERE d.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_purge_push_deliveries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_push_deliveries(integer) TO service_role;
