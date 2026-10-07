-- ============================================================================
-- Migration: connect_payout_event_ledger
-- ----------------------------------------------------------------------------
-- Adds an append-only, immutable Stripe Connect payout event evidence ledger
-- keyed by Stripe event identity, with an idempotent narrowly-granted append
-- RPC for the Stripe webhook Edge Function (Phase 2A of the payout operating
-- model). Aggregate payout-run status remains a mutable projection; this
-- ledger is the immutable evidence that reconciliation rebuilds from.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.connect_payout_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'payout.created',
      'payout.updated',
      'payout.paid',
      'payout.failed',
      'payout.canceled'
    )
  ),
  stripe_payout_id TEXT NOT NULL,
  connect_payout_run_id UUID REFERENCES public.connect_payout_runs (id)
    ON DELETE SET NULL,
  stripe_created TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_payout_status TEXT NOT NULL CHECK (
    observed_payout_status IN ('pending', 'in_transit', 'paid', 'failed', 'canceled')
  ),
  failure_code TEXT,
  failure_message TEXT,
  failure_balance_transaction TEXT
);

COMMENT ON TABLE public.connect_payout_events IS
  'Append-only, immutable Stripe Connect payout event evidence keyed by Stripe event identity; the aggregate payout-run status is a projection rebuilt from this evidence plus authoritative Stripe state.';
COMMENT ON COLUMN public.connect_payout_events.stripe_event_id IS
  'Stripe event.id; duplicate webhook deliveries dedupe on this identity and must never create a second evidence row or a second projection.';
COMMENT ON COLUMN public.connect_payout_events.stripe_created IS
  'Stripe occurrence time (event.created); webhook arrival order is not occurrence order.';
COMMENT ON COLUMN public.connect_payout_events.observed_payout_status IS
  'Observed Stripe payout state carried by the event (pending, in_transit, paid, failed, canceled).';
COMMENT ON COLUMN public.connect_payout_events.failure_balance_transaction IS
  'Stripe balance transaction returning payout funds to the Stripe balance after a payout failure; evidence for late paid→failed reversal.';

CREATE INDEX IF NOT EXISTS idx_connect_payout_events_stripe_payout_id
  ON public.connect_payout_events (stripe_payout_id, stripe_created);

CREATE INDEX IF NOT EXISTS idx_connect_payout_events_run_id
  ON public.connect_payout_events (connect_payout_run_id);

CREATE INDEX IF NOT EXISTS idx_connect_payout_events_event_type
  ON public.connect_payout_events (event_type);

-- Append-only enforcement: evidence rows are never rewritten or deleted.
CREATE OR REPLACE FUNCTION public.fn_prevent_connect_payout_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'connect_payout_events is append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_connect_payout_events_append_only
  ON public.connect_payout_events;

CREATE TRIGGER trg_connect_payout_events_append_only
  BEFORE UPDATE OR DELETE ON public.connect_payout_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_connect_payout_event_mutation();

CREATE OR REPLACE FUNCTION public.fn_append_connect_payout_event(
  p_stripe_event_id TEXT,
  p_event_type TEXT,
  p_stripe_payout_id TEXT,
  p_connect_payout_run_id UUID,
  p_stripe_created TIMESTAMPTZ,
  p_observed_payout_status TEXT,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_failure_balance_transaction TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

ALTER TABLE public.connect_payout_events ENABLE ROW LEVEL SECURITY;

-- No role is granted direct table privileges: the SECURITY DEFINER append RPC
-- runs with its owner's privileges, so service_role only needs RPC EXECUTE.
-- Direct INSERT/UPDATE/DELETE/TRUNCATE on the ledger stay impossible for
-- every caller, keeping all writes inside the narrowly-granted append flow.
REVOKE ALL ON public.connect_payout_events FROM PUBLIC;
REVOKE ALL ON public.connect_payout_events FROM anon, authenticated;
-- Explicit service_role revoke: absence of a GRANT statement in this file does
-- not prove direct privileges are absent, since a prior migration or
-- environment default could have granted them. service_role keeps
-- EXECUTE-only RPC access below.
REVOKE ALL ON public.connect_payout_events FROM service_role;
REVOKE ALL ON FUNCTION public.fn_append_connect_payout_event FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_append_connect_payout_event FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_prevent_connect_payout_event_mutation FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prevent_connect_payout_event_mutation FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_append_connect_payout_event TO service_role;

COMMIT;
