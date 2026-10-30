-- =========================================================================
-- fn_claim_push_deliveries — the dispatcher claims due deliveries (service role only)
-- Migration: supabase/migrations/*_push_outbox.sql
-- One statement: locks up to p_limit due rows (FOR UPDATE SKIP LOCKED, so two
-- dispatchers never claim the same row), then either claims each one
-- (status sending, fresh claim_token, attempts + 1) or closes it with a reason
-- in last_error: read, deleted or expired notification, a token that moved to
-- another user, disabled token, closed account (status skipped), or a crashed
-- claim that used all attempts (failed).
-- A sending row is due again only after its 5 minute lease, so a dispatcher
-- that crashed does not lose rows. Returns only the claimed rows.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_claim_push_deliveries(
  p_limit integer,
  p_max_age interval DEFAULT interval '6 hours'
)
RETURNS TABLE (
  delivery_id uuid,
  claim_token uuid,
  expo_token text,
  platform text,
  channel text,
  title text,
  message text,
  action_path text,
  notification_id uuid,
  event_kind text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'INVALID_PUSH_CLAIM_LIMIT';
  END IF;

  IF p_max_age IS NULL OR p_max_age <= interval '0' THEN
    RAISE EXCEPTION 'INVALID_PUSH_CLAIM_MAX_AGE';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT d.id,
           CASE
             WHEN d.status = 'sending' AND d.attempts >= 5 THEN 'attempts_exhausted'
             WHEN n.read IS TRUE THEN 'notification_read'
             WHEN n.deleted_at IS NOT NULL THEN 'notification_deleted'
             WHEN n.created_at < now() - p_max_age THEN 'expired'
             WHEN t.user_id IS DISTINCT FROM d.user_id THEN 'token_reassigned'
             WHEN t.disabled_at IS NOT NULL THEN 'token_disabled'
             WHEN p.id IS NULL OR p.deleted_at IS NOT NULL THEN 'account_closed'
           END AS skip_reason
    FROM public.push_deliveries d
    JOIN public.notifications n ON n.id = d.notification_id
    JOIN public.push_tokens t ON t.id = d.push_token_id
    LEFT JOIN public.profiles p ON p.id = d.user_id
    WHERE (d.status = 'pending' AND d.next_attempt_at <= now())
       OR (d.status = 'sending' AND d.claimed_at <= now() - interval '5 minutes')
    ORDER BY d.next_attempt_at, d.created_at
    LIMIT p_limit
    FOR UPDATE OF d SKIP LOCKED
  ), upd AS (
    UPDATE public.push_deliveries d SET
      status = CASE
        WHEN due.skip_reason IS NULL THEN 'sending'
        WHEN due.skip_reason = 'attempts_exhausted' THEN 'failed'
        ELSE 'skipped'
      END,
      claim_token = CASE WHEN due.skip_reason IS NULL THEN gen_random_uuid() END,
      claimed_at = CASE WHEN due.skip_reason IS NULL THEN now() END,
      attempts = d.attempts + CASE WHEN due.skip_reason IS NULL THEN 1 ELSE 0 END,
      last_error = COALESCE(due.skip_reason, d.last_error),
      updated_at = now()
    FROM due
    WHERE d.id = due.id
    RETURNING d.id, d.claim_token, d.channel, d.notification_id, d.push_token_id, d.user_id, due.skip_reason
  )
  SELECT upd.id, upd.claim_token, t.token, t.platform, upd.channel,
         n.title, n.message, n.action_path, upd.notification_id, n.event_kind
  FROM upd
  JOIN public.notifications n ON n.id = upd.notification_id
  JOIN public.push_tokens t ON t.id = upd.push_token_id
  WHERE upd.skip_reason IS NULL
    AND t.user_id = upd.user_id
  ORDER BY upd.id;
END;
$$;
