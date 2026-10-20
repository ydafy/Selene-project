BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS compensation_state TEXT,
  ADD COLUMN IF NOT EXISTS compensation_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_compensation_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compensation_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS compensation_last_error TEXT;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_compensation_state_check,
  ADD CONSTRAINT orders_compensation_state_check
    CHECK (compensation_state IS NULL OR compensation_state IN (
      'refund_pending',
      'refunding',
      'refund_failed_retry_queued',
      'refunded'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_payment_intent_id_recovery_uidx
  ON public.orders (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_checkout_recovery_claim_idx
  ON public.orders (next_compensation_retry_at, created_at)
  WHERE payment_processing = true
     AND compensation_state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding');

-- A charged intent with malformed or legacy metadata may not contain enough
-- trusted order identity to create an orders row. Keep its compensation state
-- separately so refund-first recovery remains possible without guessing a
-- buyer, address, or product reservation to release.
CREATE TABLE IF NOT EXISTS public.checkout_recovery_shells (
  stripe_payment_intent_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  source_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  charged_amount_cents BIGINT,
  compensation_state TEXT NOT NULL DEFAULT 'refund_pending'
    CHECK (compensation_state IN (
      'refund_pending',
      'refunding',
      'refund_failed_retry_queued',
      'refunded'
    )),
  compensation_attempt_count INTEGER NOT NULL DEFAULT 0,
  next_compensation_retry_at TIMESTAMPTZ,
  compensation_lease_expires_at TIMESTAMPTZ,
  stripe_refund_id TEXT,
  compensation_last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkout_recovery_shells_claim_idx
  ON public.checkout_recovery_shells (next_compensation_retry_at, created_at)
  WHERE compensation_state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding');

-- Deploy `supabase/queries/orders/checkout_recovery.sql` after this migration.
-- The maintainer configures the authenticated */5 cron invocation separately;
-- secrets must be read from Vault and never stored in this migration.

COMMIT;
