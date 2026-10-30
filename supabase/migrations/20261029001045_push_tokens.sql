-- ============================================================================
-- push_tokens: Expo push token registry (expo-push-notifications T1).
--
-- Why: push is a second delivery channel for the notifications inbox. The
-- dispatcher (later tasks) fans out to the active tokens of a user. One row per
-- device token; a user may have many devices.
--
-- Table access: RLS is on and no client role has any table privilege. Clients
-- reach the table only through the two RPCs below; service_role (the dispatcher)
-- keeps full access.
--
-- Grant review (AGENTS.md): fn_register_push_token and fn_unregister_push_token
-- are SECURITY DEFINER because clients have no access to push_tokens, and
-- registering a token another user owns must move it, which a client could not
-- do under RLS. Both act on auth.uid() only and raise for a missing session.
-- EXECUTE is revoked from PUBLIC and anon and granted to authenticated only;
-- anonymous callers have no user to register a token for.
--
-- Canonical definitions: supabase/queries/push/fn_register_push_token.sql and
-- fn_unregister_push_token.sql
-- ============================================================================

CREATE TABLE public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  disabled_reason text,
  CONSTRAINT push_tokens_token_shape_chk
    CHECK (char_length(token) <= 255 AND token ~ '^Expo(nent)?PushToken\[[^\]\s]+\]$')
);

COMMENT ON TABLE public.push_tokens IS
  'Expo push tokens, one row per device. Written only by fn_register_push_token / fn_unregister_push_token and the push dispatcher (service role). disabled_at is set when Expo reports the token as dead.';

-- The dispatcher fans out to the active tokens of one user.
CREATE INDEX push_tokens_active_user_idx ON public.push_tokens (user_id) WHERE disabled_at IS NULL;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_tokens TO service_role;

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

CREATE OR REPLACE FUNCTION public.fn_unregister_push_token(p_token text)
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

  DELETE FROM public.push_tokens WHERE token = p_token AND user_id = v_user_id;
END;
$$;

COMMENT ON FUNCTION public.fn_unregister_push_token(text) IS
  'Client RPC (SECURITY DEFINER, authenticated only): deletes the caller''s own push token row. A missing or foreign token is a no-op.';

REVOKE EXECUTE ON FUNCTION public.fn_unregister_push_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unregister_push_token(text) TO authenticated;
