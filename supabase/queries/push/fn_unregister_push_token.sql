-- =========================================================================
-- fn_unregister_push_token — a device removes its own push token
-- Migration: supabase/migrations/*_push_tokens.sql, then *_unregister_push_token_by_device.sql
-- Deletes the row with this exact token, whoever calls it (anon, authenticated
-- or service role): holding the token proves the device, so sign-out can
-- remove it after the session is gone. A missing token is a no-op, so the call
-- stays idempotent. A malformed token raises INVALID_PUSH_TOKEN, with the same
-- check as fn_register_push_token.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_unregister_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_token IS NULL
     OR char_length(p_token) > 255
     OR p_token !~ '^Expo(nent)?PushToken\[[^\]\s]+\]$' THEN
    RAISE EXCEPTION 'INVALID_PUSH_TOKEN';
  END IF;

  DELETE FROM public.push_tokens WHERE token = p_token;
END;
$$;

COMMENT ON FUNCTION public.fn_unregister_push_token(text) IS
  'Client RPC (SECURITY DEFINER, anon and authenticated): deletes the push token row with this exact token, whoever calls it. A missing token is a no-op; a malformed token raises INVALID_PUSH_TOKEN.';

REVOKE EXECUTE ON FUNCTION public.fn_unregister_push_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_unregister_push_token(text) TO anon, authenticated;
