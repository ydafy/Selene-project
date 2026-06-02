-- Migration: fix_admin_payments_security
-- Created: 2026-06-01
-- Description: Fix SECURITY DEFINER warning on admin_payments_overview view.
--              Switch to security_invoker + add admin RLS bypass policies
--              on underlying tables so the view works with caller permissions.
-- Prerequisite: 20260601040000_admin_payments_overview.sql (already applied)

-- 1. Recreate view with security_invoker = true
-- PostgreSQL 15+ requires DROP + CREATE to change security_invoker property
-- (CREATE OR REPLACE VIEW cannot alter it).
DROP VIEW IF EXISTS admin_payments_overview;

CREATE OR REPLACE VIEW admin_payments_overview WITH (security_invoker = true) AS
SELECT
  pr.id,
  pr.user_id,
  p.username as seller_name,
  pr.amount,
  pr.status,
  sba.clabe,
  sba.bank_name,
  sba.is_verified,
  sba.account_holder_name,
  pr.requested_at,
  pr.processed_at,
  pr.processed_by,
  pr.completed_at,
  pr.rejected_reason,
  pr.rejected_at,
  ap.username as processed_by_name
FROM payout_requests pr
JOIN seller_bank_accounts sba ON sba.id = pr.bank_account_id
JOIN profiles p ON p.id = pr.user_id
LEFT JOIN profiles ap ON ap.id = pr.processed_by;

-- 2. Admin RLS bypass policies for underlying tables
-- The view now uses security_invoker = true, so it respects RLS on the base
-- tables. These policies ensure admin users can read all rows through the view.

DROP POLICY IF EXISTS admin_payments_select ON payout_requests;
CREATE POLICY admin_payments_select ON payout_requests
  FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS admin_payments_select ON seller_bank_accounts;
CREATE POLICY admin_payments_select ON seller_bank_accounts
  FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS admin_payments_select ON profiles;
CREATE POLICY admin_payments_select ON profiles
  FOR SELECT TO authenticated
  USING (is_admin());

-- 3. Re-grant view access
REVOKE ALL ON admin_payments_overview FROM PUBLIC;
GRANT SELECT ON admin_payments_overview TO authenticated;
