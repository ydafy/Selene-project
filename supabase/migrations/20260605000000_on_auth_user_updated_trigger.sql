-- ============================================================================
-- Migration: on_auth_user_updated trigger
-- Change: account-settings-extended (EXTD-TASK-001, CONF-019)
-- ----------------------------------------------------------------------------
-- Purpose:
--   Sync auth.users.email -> public.profiles_private.email when an email
--   change is confirmed. Idempotent — safe to re-run.
--
-- History:
--   The earlier source file `fn_on_auth_user_updated.sql` referenced
--   public.profiles.email, but that column was migrated to
--   public.profiles_private. There was also NO trigger wired on auth.users
--   for UPDATE events. This migration fixes both issues atomically.
-- ============================================================================

BEGIN;

-- 1. Drop the trigger first (idempotent) so we can replace the function safely.
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

-- 2. Replace the function body. Uses profiles_private (NOT profiles.email
--    which no longer exists). Locked search_path for SECURITY DEFINER hygiene.
CREATE OR REPLACE FUNCTION public.fn_on_auth_user_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles_private
  SET email = NEW.email,
      updated_at = now()
  WHERE id = NEW.id;

  IF NOT FOUND THEN
    RAISE WARNING 'profiles_private row missing for user %', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Reattach trigger. Fires only when email actually changes — avoids
--    needless writes on session refresh / metadata bumps.
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.fn_on_auth_user_updated();

COMMIT;
