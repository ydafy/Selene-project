-- Canonical definition of public.fn_list_push_receipts_due.
-- Service role only (dispatch-push). Lists Expo push tickets whose receipt is due:
-- Expo recommends checking receipts 15 minutes after sending. A ticket whose
-- receipt was not there yet is re-checked at most every 15 minutes, after the
-- tickets never checked, so it cannot starve newer ones.
-- Migration: supabase/migrations/20261030025554_push_receipts_and_purge.sql

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
