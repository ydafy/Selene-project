-- =========================================================================
-- account_closures — one row per user closed by fn_close_account
-- Migration: supabase/migrations/*_account_closure.sql
-- Source of truth that an account was anonymized and closed (auth-hardening S8).
-- Holds the Stripe ids captured at closure so the Edge Function can clean
-- Stripe and Storage after the database transaction and retry until each step
-- is done. Service role only: RLS is on and no client policy or grant exists.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.account_closures (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  stripe_customer_id text,
  stripe_account_id text,
  stripe_customer_cleanup text NOT NULL DEFAULT 'pending'
    CHECK (stripe_customer_cleanup IN ('pending', 'done', 'failed', 'not_needed')),
  stripe_account_cleanup text NOT NULL DEFAULT 'pending'
    CHECK (stripe_account_cleanup IN ('pending', 'done', 'failed', 'not_needed')),
  storage_cleanup text NOT NULL DEFAULT 'pending'
    CHECK (storage_cleanup IN ('pending', 'done', 'failed', 'not_needed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_closures FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_closures FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_closures TO service_role;

COMMENT ON TABLE public.account_closures IS
  'One row per closed account. Written by fn_close_account; the delete-account Edge Function and its retry worker update the cleanup columns. Service role only.';
