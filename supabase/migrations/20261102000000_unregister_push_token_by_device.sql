-- ============================================================================
-- fn_unregister_push_token: a device removes its push token without a session
-- (expo-push-notifications T9b, S1).
--
-- Why: sign-out removed the token only when the unregister call reached the
-- server with a live session. When the network failed, the app could not remove
-- the token later, because by then there was no session. The call now takes the
-- token alone: it deletes the row with that exact token, whoever calls it, so
-- the app can retry after the session is gone. A missing token is a no-op. A
-- malformed token (NULL, over 255 characters, or not an Expo token) raises
-- INVALID_PUSH_TOKEN, with the same check as fn_register_push_token.
--
-- Signature and return type do not change (text, void), so the generated types
-- do not change.
--
-- Grant review (AGENTS.md): stays SECURITY DEFINER with search_path
-- 'public, pg_temp' because clients have no access to push_tokens. EXECUTE is
-- revoked from PUBLIC and granted to anon and authenticated. Anon EXECUTE is
-- intended: holding the token is the proof of the device, no client can read
-- push_tokens (REVOKE ALL from anon and authenticated in
-- 20261029001045_push_tokens.sql), tokens are not logged, and the only effect
-- is that the device stops receiving push. service_role keeps its default EXECUTE.
--
-- Canonical definition: supabase/queries/push/fn_unregister_push_token.sql
-- ============================================================================
BEGIN;

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

COMMIT;
