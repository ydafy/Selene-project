-- =========================================================================
-- fn_enqueue_push_deliveries — AFTER INSERT trigger function on public.notifications
-- Migration: supabase/migrations/*_push_outbox.sql
-- Fans a typed notification out to one push_deliveries row per active token of
-- the recipient, only when (event_kind, recipient_role) is in push_event_policy
-- and the recipient account is open. Runs in the producer's transaction, so a
-- producer that rolls back leaves no delivery. Never raises: missing tokens,
-- policy or profile just produce no rows.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_enqueue_push_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.push_deliveries (notification_id, push_token_id, user_id, channel)
  SELECT NEW.id, t.id, NEW.user_id, pol.channel
  FROM public.push_event_policy pol
  JOIN public.push_tokens t ON t.user_id = NEW.user_id AND t.disabled_at IS NULL
  JOIN public.profiles p ON p.id = NEW.user_id AND p.deleted_at IS NULL
  WHERE pol.event_kind = NEW.event_kind
    AND pol.recipient_role = NEW.event_payload->>'recipient_role'
  FOR KEY SHARE OF t
  ON CONFLICT (notification_id, push_token_id) DO NOTHING;

  RETURN NEW;
END;
$$;
