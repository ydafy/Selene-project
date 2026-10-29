-- =========================================================================
-- fn_unregister_push_token — sign-out removes this device's token
-- Migration: supabase/migrations/*_push_tokens.sql
-- Deletes the row only when it belongs to the caller. A missing or foreign
-- token is a no-op, so sign-out stays idempotent and cannot probe other users.
-- =========================================================================

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
