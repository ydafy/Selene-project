-- ============================================================================
-- Reserve the "deleted_" username prefix for closed accounts (T8g, L77).
--
-- Why: fn_close_account renames a closed profile to "deleted_" + 12 hex, and
-- the apps and admin-web treat that shape as a closed account in some paths.
-- Nothing stopped a user from choosing such a username at sign-up or in the
-- profile editor (clients hold UPDATE (username) on profiles).
--
-- Design:
--   * One BEFORE INSERT OR UPDATE OF username trigger on public.profiles
--     covers every writer: the signup trigger, the profile editor and any
--     future path. It rejects a case-insensitive "deleted_" prefix with
--     check_violation, the code the signup trigger already uses for a bad
--     username, so the sign-up error path and the app mapping are unchanged.
--   * Only the closure may write the prefix: an UPDATE that sets deleted_at
--     (NULL -> set) in the same statement, run by a role other than anon or
--     authenticated. fn_close_account (SECURITY DEFINER, runs as its owner)
--     does exactly that. The role test matters because a client role may hold
--     UPDATE on deleted_at (the local stack does: its default privileges give
--     anon and authenticated every column), so the deleted_at fact alone is
--     not enough; current_user is the owner inside a definer function and the
--     client role for a direct PostgREST update. A transaction-local setting
--     was rejected because it adds hidden state that other code could set.
--   * An UPDATE that leaves the username unchanged is never rejected, so rows
--     that already look like closed accounts keep working and are not touched
--     (this migration reads and writes no data). Such a row can still not be
--     renamed to another reserved name.
--   * fn_generate_profile_username puts "user_" in front of a derived base
--     that starts with "deleted_" (email prefix, Google name), so provisioning
--     never fails or generates a reserved name. A typed "deleted_x" at sign-up
--     fails with check_violation from the profiles trigger (the signup trigger
--     re-raises check_violation unchanged).
--
-- Grant review (AGENTS.md): fn_reserve_deleted_username is SECURITY INVOKER
-- (it only reads NEW/OLD), has an explicit search_path and is called only by
-- the trigger. EXECUTE is revoked from PUBLIC, anon and authenticated;
-- service_role keeps it through default privileges. No anonymous access is
-- intended. fn_generate_profile_username keeps its existing ACL (CREATE OR
-- REPLACE preserves it); the revoke is restated.
--
-- Existing data: run before applying to list look-alike rows that are not
-- closed (they are left as they are):
--   SELECT id, username FROM public.profiles
--   WHERE username ILIKE 'deleted\_%' AND deleted_at IS NULL;
--
-- Canonical definitions: supabase/queries/triggers/auth/
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_generate_profile_username(p_raw text)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text;
  v_candidate text;
  v_suffix text;
  v_attempt int := 0;
  v_digits int;
BEGIN
  v_base := lower(
    translate(coalesce(p_raw, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')
  );
  v_base := regexp_replace(v_base, '[^a-z0-9_.]', '', 'g');
  IF char_length(v_base) < 3 THEN
    v_base := v_base || 'user';
  END IF;
  -- "deleted_" is reserved for closed accounts (fn_close_account). A bare
  -- "deleted" counts too: a collision suffix would turn it into deleted_NNNN.
  IF v_base = 'deleted' OR v_base LIKE 'deleted\_%' THEN
    v_base := 'user_' || v_base;
  END IF;
  v_base := left(v_base, 20);

  v_candidate := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE username = v_candidate
    );
    v_attempt := v_attempt + 1;
    -- Bound the search so the auth insert can never loop forever; with up to
    -- 10^8 suffixes per base this is unreachable in practice.
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'Could not generate a free username for base %', v_base;
    END IF;
    -- Widen the suffix every 5 attempts so a crowded base still resolves.
    v_digits := least(4 + v_attempt / 5, 8);
    v_suffix := '_' || lpad(
      floor(random() * power(10, v_digits))::bigint::text, v_digits, '0'
    );
    v_candidate := left(v_base, 20 - char_length(v_suffix)) || v_suffix;
  END LOOP;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_generate_profile_username(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_reserve_deleted_username()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.username IS NOT DISTINCT FROM OLD.username THEN
    RETURN NEW;
  END IF;

  IF NEW.username ILIKE 'deleted\_%' THEN
    IF TG_OP = 'UPDATE'
       AND current_user NOT IN ('anon', 'authenticated')
       AND OLD.deleted_at IS NULL
       AND NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Username "%" is reserved', NEW.username
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reserve_deleted_username()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_profiles_reserve_deleted_username ON public.profiles;
CREATE TRIGGER tr_profiles_reserve_deleted_username
  BEFORE INSERT OR UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_reserve_deleted_username();

COMMIT;
