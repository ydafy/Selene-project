-- Migration: admin_payments_overview
-- Created: 2026-06-01
-- Description: Create payout_status enum, add tracking columns to payout_requests,
--              create admin_payments_overview view, and grant permissions.

-- 1. Create payout_status ENUM
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'payout_status'
  ) THEN
    CREATE TYPE payout_status AS ENUM ('pending', 'processing', 'completed', 'rejected');
  END IF;
END
$$;

-- 2. Alter payout_requests.status to use the enum with default
DO $$
DECLARE
  constraint_name text;
BEGIN
  -- First, update any existing rows with invalid statuses to 'pending'
  UPDATE payout_requests
  SET status = 'pending'
  WHERE status IS NULL OR status NOT IN ('pending', 'processing', 'completed', 'rejected');

  -- Drop any CHECK constraint on the status column (it uses text comparisons
  -- that are incompatible with the enum type — the enum itself enforces valid values)
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'payout_requests'
    AND att.attname = 'status'
    AND con.contype = 'c';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payout_requests DROP CONSTRAINT %I', constraint_name);
  END IF;

  -- Drop existing default before changing type (PostgreSQL can't auto-cast text default to enum)
  ALTER TABLE payout_requests
    ALTER COLUMN status DROP DEFAULT;

  -- Alter column type
  ALTER TABLE payout_requests
    ALTER COLUMN status TYPE payout_status
    USING status::payout_status;

  -- Set new enum default
  ALTER TABLE payout_requests
    ALTER COLUMN status SET DEFAULT 'pending';
END
$$;

-- 3. Add new tracking columns to payout_requests
ALTER TABLE payout_requests
ADD COLUMN IF NOT EXISTS completed_at timestamptz,
ADD COLUMN IF NOT EXISTS rejected_reason text,
ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- 4. Create admin_payments_overview view
-- security_invoker = true: the view respects the calling user's permissions
-- against the underlying tables and their RLS policies, preventing
-- SECURITY DEFINER bypass of table-level RLS.
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

-- 5. Admin RLS bypass policies for underlying tables
-- The view uses security_invoker = true, so it respects RLS on the base tables.
-- These policies ensure admin users can read all rows through the view.

-- payout_requests: admin bypass for SELECT
DROP POLICY IF EXISTS admin_payments_select ON payout_requests;
CREATE POLICY admin_payments_select ON payout_requests
  FOR SELECT TO authenticated
  USING (is_admin());

-- seller_bank_accounts: admin bypass for SELECT
DROP POLICY IF EXISTS admin_payments_select ON seller_bank_accounts;
CREATE POLICY admin_payments_select ON seller_bank_accounts
  FOR SELECT TO authenticated
  USING (is_admin());

-- profiles: admin bypass for SELECT (in case strict RLS is enabled)
DROP POLICY IF EXISTS admin_payments_select ON profiles;
CREATE POLICY admin_payments_select ON profiles
  FOR SELECT TO authenticated
  USING (is_admin());

-- 6. Grant access to the view
REVOKE ALL ON admin_payments_overview FROM PUBLIC;
GRANT SELECT ON admin_payments_overview TO authenticated;
