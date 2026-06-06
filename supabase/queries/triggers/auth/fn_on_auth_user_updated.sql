-- Source body for public.fn_on_auth_user_updated().
-- Migration: supabase/migrations/*_on_auth_user_updated*.sql
-- Syncs auth.users.email -> public.profiles_private.email after confirmed updates.
BEGIN
  UPDATE public.profiles_private
  SET email = NEW.email,
      updated_at = now()
  WHERE id = NEW.id;

  -- Audit if the private row is missing (should never happen if signup trigger ran).
  IF NOT FOUND THEN
    RAISE WARNING 'profiles_private row missing for user %', NEW.id;
  END IF;

  RETURN NEW;
END;
