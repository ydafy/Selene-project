-- Issue #154: two AFTER UPDATE triggers on auth.users ran fn_on_auth_user_updated.
-- tr_on_auth_user_updated fired on every update, including each sign-in (GoTrue
-- updates last_sign_in_at), so every sign-in rewrote profiles_private.email and
-- updated_at; on an email change the function ran twice. on_auth_user_updated,
-- guarded by WHEN (OLD.email IS DISTINCT FROM NEW.email), already covers the only
-- thing the function does (mirror the email), so the unguarded one goes.
--
-- Grant review: no function or grant changes. Re-running is safe (IF EXISTS).
DROP TRIGGER IF EXISTS tr_on_auth_user_updated ON auth.users;
