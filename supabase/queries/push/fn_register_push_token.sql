-- =========================================================================
-- fn_register_push_token — a signed-in user registers this device's Expo push token
-- Migration: supabase/migrations/*_push_tokens.sql, then *_register_push_token_closed_account.sql
-- One row per device token. A token another user owns moves to the caller (the
-- same device signed in to a different account). Re-registering clears any
-- disabled state. Idempotent. A closed account (profiles.deleted_at set) raises
-- ACCOUNT_CLOSED: closure deletes its tokens, so a still-valid session must not
-- register new ones.
-- =========================================================================

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
