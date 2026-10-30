-- ============================================================================
-- fn_register_push_token: reject a closed account (expo-push-notifications T2).
--
-- Why: fn_close_account deletes the user's push tokens but keeps the auth.users
-- row, and a session issued before the closure can stay valid. Without this
-- guard that session could register a token again and a closed account would
-- receive pushes. Only change: raise ACCOUNT_CLOSED when profiles.deleted_at is
-- set. Apply after the push_tokens migration.
--
-- Grant review: unchanged. Still SECURITY DEFINER with a pinned search_path;
-- EXECUTE stays revoked from PUBLIC and anon and granted to authenticated only
-- (restated below).
--
-- Canonical definition: supabase/queries/push/fn_register_push_token.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_register_push_token(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ACCOUNT_CLOSED';
  END IF;

  IF p_token IS NULL
     OR char_length(p_token) > 255
     OR p_token !~ '^Expo(nent)?PushToken\[[^\]\s]+\]$' THEN
    RAISE EXCEPTION 'INVALID_PUSH_TOKEN';
  END IF;

  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'INVALID_PUSH_PLATFORM';
  END IF;

  INSERT INTO public.push_tokens (user_id, token, platform)
  VALUES (v_user_id, p_token, p_platform)
  ON CONFLICT (token) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    updated_at = now(),
    disabled_at = NULL,
    disabled_reason = NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_register_push_token(text, text) IS
  'Client RPC (SECURITY DEFINER, authenticated only): registers the caller''s Expo push token. A token owned by another user moves to the caller; re-registering clears the disabled state. Idempotent.';

REVOKE EXECUTE ON FUNCTION public.fn_register_push_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_register_push_token(text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_register_push_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_register_push_token(text, text) TO authenticated;
