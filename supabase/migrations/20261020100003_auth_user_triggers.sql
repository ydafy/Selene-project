-- Auth part of the schema baseline. `supabase db dump` exports only the
-- project's own schemas, so the custom triggers on auth.users are recreated
-- here exactly as they exist in project acoiclkeymgtlwcxilun on 2026-10-20.
--
-- tr_on_auth_user_created provisions profiles, profiles_private and wallets
-- for every new auth user. Both update triggers call the same function; on an
-- email change it runs twice. That mirrors the remote and is not fixed here.
--
-- Idempotent: each trigger is dropped before it is created.
BEGIN;

DROP TRIGGER IF EXISTS tr_on_auth_user_created ON auth.users;
CREATE TRIGGER tr_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_on_auth_user_created();

DROP TRIGGER IF EXISTS tr_on_auth_user_updated ON auth.users;
CREATE TRIGGER tr_on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_on_auth_user_updated();

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.fn_on_auth_user_updated();

COMMIT;
