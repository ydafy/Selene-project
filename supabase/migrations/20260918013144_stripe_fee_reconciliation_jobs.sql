BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_fee_reconciliation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  stripe_payment_intent_id TEXT NOT NULL CHECK (
    char_length(stripe_payment_intent_id) BETWEEN 1 AND 255
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  next_retry_at TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, stripe_payment_intent_id)
);

COMMENT ON TABLE public.stripe_fee_reconciliation_jobs IS
  'Server-only recovery ledger for reconciling actual Stripe processing fees against paid orders.';
COMMENT ON COLUMN public.stripe_fee_reconciliation_jobs.attempt_count IS
  'Bounded count of reconciliation attempts, including the active processing attempt.';
COMMENT ON COLUMN public.stripe_fee_reconciliation_jobs.next_retry_at IS
  'Earliest time a pending or failed reconciliation job is eligible for its next attempt.';

CREATE INDEX IF NOT EXISTS stripe_fee_reconciliation_jobs_retry_idx
  ON public.stripe_fee_reconciliation_jobs (next_retry_at, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.stripe_fee_reconciliation_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stripe_fee_reconciliation_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_fee_reconciliation_jobs TO service_role;

COMMIT;
