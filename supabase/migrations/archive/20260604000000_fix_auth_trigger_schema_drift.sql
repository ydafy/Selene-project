-- Fix: fn_on_auth_user_created was inserting email, role, status into
-- public.profiles. Those columns were migrated to public.profiles_private.
-- New signups were broken — the INSERT to profiles would fail.
-- This migration splits the insert into both tables.

BEGIN;

-- Drop existing trigger temporarily to replace the function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Replace function with fixed version
CREATE OR REPLACE FUNCTION public.fn_on_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A. Public profile (visible data only)
  INSERT INTO public.profiles (id, username, avatar_url, is_verified_seller)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  -- B. Private profile (email, role, status — Zero Trust)
  INSERT INTO public.profiles_private (id, email, role, status)
  VALUES (NEW.id, NEW.email, 'user', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- C. Wallet
  INSERT INTO public.wallets (user_id, available_balance, pending_balance)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALLO CRÍTICO EN SETUP DE USUARIO: %', SQLERRM;
END;
$$;

-- Reattach trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_on_auth_user_created();

COMMIT;
