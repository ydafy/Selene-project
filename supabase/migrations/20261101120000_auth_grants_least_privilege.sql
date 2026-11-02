-- Issue #122 (auth part), L172: leave anon and authenticated exactly the
-- privileges the clients use on the auth tables and the admin views.
--
-- Cause: these relations kept the default grants (every table privilege for
-- anon and authenticated), so the only thing between a client and a
-- profiles_private or admin_* write was RLS. RLS stays the row control; this
-- migration removes the privileges nobody needs as defence in depth.
--
-- Grant review: the migration only REVOKEs and then re-GRANTs a strict subset to
-- authenticated. It grants nothing to anon, so anon keeps SELECT on profiles
-- only. service_role and postgres are untouched, so Edge Functions and
-- SECURITY DEFINER functions are unaffected. A table-level REVOKE also removes
-- column privileges, so the profiles UPDATE columns are granted again below.
-- Re-running the migration leaves the same result.
BEGIN;

REVOKE ALL ON TABLE
  public.profiles,
  public.profiles_private,
  public.admin_audit_logs,
  public.admin_user_notes,
  public.admin_user_directory_view,
  public.admin_disputes_monitor_view,
  public.admin_product_queue_view,
  public.admin_connect_earnings_view,
  public.admin_seller_onboarding_view
FROM anon, authenticated;

-- profiles is public data: anyone reads it, and a user edits only their own
-- username, avatar and updated_at (RLS limits the rows).
GRANT SELECT ON TABLE public.profiles TO anon, authenticated;
GRANT UPDATE (avatar_url, updated_at, username) ON TABLE public.profiles TO authenticated;

-- Reads for signed-in users; RLS (own row or is_admin()) decides which rows.
GRANT SELECT ON TABLE
  public.profiles_private,
  public.admin_audit_logs,
  public.admin_user_directory_view,
  public.admin_disputes_monitor_view,
  public.admin_product_queue_view
TO authenticated;

-- Admin notes are read and added from the admin dashboard; never edited.
GRANT SELECT, INSERT ON TABLE public.admin_user_notes TO authenticated;

-- admin_connect_earnings_view and admin_seller_onboarding_view stay without any
-- client privilege, like admin_connect_payout_release_view and account_closures.

COMMIT;
