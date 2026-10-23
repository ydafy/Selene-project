-- =========================================================================
-- fn_claim_account_closures / fn_record_closure_attempt
-- Migration: supabase/migrations/*_account_closure_cleanup.sql
-- Atomic claim and attempt count behind the account-closure-cleanup worker and
-- delete-account (auth-hardening S8). Service role only, SECURITY INVOKER: the
-- service role already holds SELECT/UPDATE on public.account_closures.
-- =========================================================================

-- Claims a bounded batch of closures whose cleanup still has a pending or failed step.
-- One statement selects the rows (oldest first, FOR UPDATE SKIP LOCKED), adds one to
-- attempts and moves updated_at, so concurrent runs never claim the same row and never
-- undercount. A row touched within p_min_idle (a live delete-account request) and a row
-- at p_max_attempts are left alone.
CREATE OR REPLACE FUNCTION public.fn_claim_account_closures(
  p_limit integer,
  p_min_idle interval,
  p_max_attempts integer
)
RETURNS SETOF public.account_closures
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_min_idle IS NULL OR p_min_idle < interval '0'
     OR p_max_attempts IS NULL OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  RETURN QUERY
  UPDATE public.account_closures AS c
  SET attempts = c.attempts + 1,
      updated_at = now()
  WHERE c.user_id IN (
    SELECT a.user_id
    FROM public.account_closures AS a
    WHERE (
        a.stripe_customer_cleanup IN ('pending', 'failed')
        OR a.stripe_account_cleanup IN ('pending', 'failed')
        OR a.storage_cleanup IN ('pending', 'failed')
      )
      AND a.attempts < p_max_attempts
      AND a.updated_at <= now() - p_min_idle
    ORDER BY a.updated_at, a.user_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING c.*;
END;
$$;

COMMENT ON FUNCTION public.fn_claim_account_closures(integer, interval, integer) IS
  'Service-only (SECURITY INVOKER): atomically claims up to p_limit closures with an open cleanup step, oldest first, adding one attempt each. Skips rows touched within p_min_idle and rows at p_max_attempts.';

-- Adds one attempt (or none) and stamps last_error in a single UPDATE, so concurrent
-- writers cannot lose a count the way read-then-write could.
CREATE OR REPLACE FUNCTION public.fn_record_closure_attempt(
  p_user_id uuid,
  p_last_error text,
  p_count_attempt boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  UPDATE public.account_closures
  SET attempts = attempts + CASE WHEN p_count_attempt THEN 1 ELSE 0 END,
      last_error = left(p_last_error, 500),
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.fn_record_closure_attempt(uuid, text, boolean) IS
  'Service-only (SECURITY INVOKER): atomically adds one attempt (when p_count_attempt) and stamps last_error and updated_at on an account closure.';

REVOKE EXECUTE ON FUNCTION public.fn_claim_account_closures(integer, interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_account_closures(integer, interval, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_record_closure_attempt(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_closure_attempt(uuid, text, boolean) TO service_role;
