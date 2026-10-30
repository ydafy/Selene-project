-- ============================================================================
-- push_event_policy and push_deliveries: push outbox (expo-push-notifications T2).
--
-- Why: push is a delivery channel of public.notifications. push_event_policy
-- says which (event_kind, recipient_role) pairs are pushed and on which Android
-- channel; adding a kind to push later is one INSERT. An AFTER INSERT trigger on
-- notifications writes one push_deliveries row per active token of the
-- recipient, in the producer's transaction, so a rolled-back producer leaves no
-- delivery. The dispatcher (T3) claims and records through the two RPCs below.
--
-- Table access: RLS is on and no client role has any table privilege on either
-- table; service_role keeps full access.
--
-- Grant review (AGENTS.md):
-- * fn_enqueue_push_deliveries is a SECURITY DEFINER trigger function: the
--   producers run as clients or definers and have no access to push tables. It
--   never raises. EXECUTE is revoked from PUBLIC, anon and authenticated and not
--   granted; only the trigger invokes it.
-- * fn_claim_push_deliveries and fn_record_push_results are SECURITY DEFINER,
--   check auth.role() = 'service_role', and have EXECUTE revoked from PUBLIC,
--   anon and authenticated and granted to service_role only. They decide what is
--   sent to a user's device.
--
-- Canonical definitions: supabase/queries/push/fn_enqueue_push_deliveries.sql,
-- fn_claim_push_deliveries.sql and fn_record_push_results.sql
-- ============================================================================

CREATE TABLE public.push_event_policy (
  event_kind text NOT NULL,
  recipient_role text NOT NULL CHECK (recipient_role IN ('buyer', 'seller')),
  channel text NOT NULL CHECK (channel IN ('orders', 'activity')),
  PRIMARY KEY (event_kind, recipient_role)
);

COMMENT ON TABLE public.push_event_policy IS
  'Allowlist of notification (event_kind, recipient_role) pairs that are also delivered by push, with the Android channel. Read by fn_enqueue_push_deliveries. To push a new kind, insert one row.';

ALTER TABLE public.push_event_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_event_policy FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_event_policy TO service_role;

-- recipient_role values come from the producers' event_payload: order.payment_confirmed
-- is never pushed to the buyer (S5); dispute.opened and the product verdicts only
-- notify the seller; return.seller_evidence_submitted only notifies the buyer.
INSERT INTO public.push_event_policy (event_kind, recipient_role, channel) VALUES
  ('order.payment_confirmed', 'seller', 'orders'),
  ('shipment.cancelled', 'buyer', 'orders'),
  ('shipment.cancelled', 'seller', 'orders'),
  ('shipment.refund_failed', 'buyer', 'orders'),
  ('dispute.opened', 'seller', 'orders'),
  ('dispute.verdict', 'buyer', 'orders'),
  ('dispute.verdict', 'seller', 'orders'),
  ('return.delivered', 'buyer', 'orders'),
  ('return.delivered', 'seller', 'orders'),
  ('return.seller_evidence_submitted', 'buyer', 'orders'),
  ('product.approved', 'seller', 'orders'),
  ('product.approved_with_note', 'seller', 'orders'),
  ('product.rejected', 'seller', 'orders'),
  ('product.available', 'buyer', 'activity'),
  ('product.interest', 'seller', 'activity');

CREATE TABLE public.push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  push_token_id uuid NOT NULL REFERENCES public.push_tokens(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('orders', 'activity')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  expo_ticket_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, push_token_id)
);

COMMENT ON TABLE public.push_deliveries IS
  'Push outbox: one row per (notification, push token). Written by fn_enqueue_push_deliveries; claimed and completed by the dispatcher through fn_claim_push_deliveries and fn_record_push_results. expo_ticket_id and sent_at let the dispatcher check receipts later.';

-- The dispatcher scans only rows that still have work to do.
CREATE INDEX push_deliveries_claim_idx ON public.push_deliveries (next_attempt_at) WHERE status IN ('pending', 'sending');
-- Deleting a token cascades to its deliveries.
CREATE INDEX push_deliveries_push_token_idx ON public.push_deliveries (push_token_id);

ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_deliveries TO service_role;

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

REVOKE EXECUTE ON FUNCTION public.fn_enqueue_push_deliveries() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notifications_enqueue_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.event_kind IS NOT NULL)
  EXECUTE FUNCTION public.fn_enqueue_push_deliveries();

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

REVOKE EXECUTE ON FUNCTION public.fn_claim_push_deliveries(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_push_deliveries(integer, interval) TO service_role;

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

REVOKE EXECUTE ON FUNCTION public.fn_record_push_results(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_push_results(jsonb) TO service_role;
