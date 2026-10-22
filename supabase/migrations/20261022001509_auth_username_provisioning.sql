-- ============================================================================
-- Username provisioning for new auth users (B1, B2, B3 of auth-hardening L43).
--
-- Why: fn_on_auth_user_created inserted profiles.username from the metadata
-- username, then full_name, then the email prefix, with only ON CONFLICT (id).
-- profiles has UNIQUE (username) and CHECK (3..20 characters), so a Google
-- first login with a long or duplicate full name made the whole signup fail
-- ("Database error saving new user"), and one 2025 auth user ended up with no
-- profile rows at all.
--
-- Policy (maintainer, L44):
--   * A username typed in the registration form is used as is. Outside 3..20
--     characters or already taken, the signup fails with a clear exception
--     (check_violation / unique_violation); the client pre-check prevents this
--     in normal use.
--   * A derived username (full_name, name, then email prefix) is normalized to
--     the profile editor charset (letters, digits, underscore, dot), clamped to
--     3..20 and suffixed with random digits (for example mariafernanda_4821)
--     until free, so provisioning never fails.
--   * profiles_private, wallets and ON CONFLICT (id) DO NOTHING are unchanged.
--
-- Grant review (AGENTS.md): fn_on_auth_user_created stays SECURITY DEFINER with
-- an explicit search_path; only the auth.users trigger calls it, and the
-- trigger runs it as its owner. CREATE OR REPLACE preserves the existing ACL,
-- so the revokes are restated: PUBLIC, anon and authenticated must not execute
-- it. The new helper fn_generate_profile_username is SECURITY INVOKER, has no
-- caller other than the trigger and the one-off repair below, and is revoked
-- from PUBLIC, anon and authenticated (service_role keeps EXECUTE through the
-- default privileges). Anonymous access is not intended for either function.
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

CREATE OR REPLACE FUNCTION public.fn_on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_typed text := NULLIF(btrim(NEW.raw_user_meta_data->>'username'), '');
  v_source text;
  v_username text;
BEGIN
  IF v_typed IS NOT NULL THEN
    IF char_length(v_typed) NOT BETWEEN 3 AND 20 THEN
      RAISE EXCEPTION 'Username must be between 3 and 20 characters'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_typed) THEN
      RAISE EXCEPTION 'Username "%" is already taken', v_typed
        USING ERRCODE = 'unique_violation';
    END IF;
    v_username := v_typed;
  ELSE
    v_source := COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    );
    v_username := public.fn_generate_profile_username(v_source);
  END IF;

  -- A. Public profile. A concurrent signup can take the chosen username
  -- between the check and the insert: retry a derived one, reject a typed one.
  LOOP
    BEGIN
      INSERT INTO public.profiles (
        id, username, avatar_url, is_verified_seller
      )
      VALUES (
        NEW.id,
        v_username,
        NEW.raw_user_meta_data->>'avatar_url',
        false
      )
      ON CONFLICT (id) DO NOTHING;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_typed IS NOT NULL THEN
        RAISE EXCEPTION 'Username "%" is already taken', v_typed
          USING ERRCODE = 'unique_violation';
      END IF;
      v_username := public.fn_generate_profile_username(v_source);
    END;
  END LOOP;

  -- B. Private profile (email, role, status — Zero Trust)
  INSERT INTO public.profiles_private (id, email, role, status)
  VALUES (NEW.id, NEW.email, 'user', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- C. Wallet (deprecated, kept unchanged)
  INSERT INTO public.wallets (user_id, available_balance, pending_balance)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN check_violation OR unique_violation THEN
    RAISE;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'FALLO CRÍTICO EN SETUP DE USUARIO: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_on_auth_user_created()
  FROM PUBLIC, anon, authenticated;

-- Backfill (B3): give every auth user without profile rows the missing ones.
-- Idempotent: a user that already has both rows is not selected, and every
-- insert is ON CONFLICT (id) DO NOTHING. Nothing else is created.
DO $backfill$
DECLARE
  r record;
  v_typed text;
  v_username text;
BEGIN
  FOR r IN
    SELECT u.id, u.email, u.raw_user_meta_data AS meta,
           (p.id IS NULL) AS missing_profile,
           (pp.id IS NULL) AS missing_private
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.profiles_private pp ON pp.id = u.id
    WHERE p.id IS NULL OR pp.id IS NULL
  LOOP
    IF r.missing_profile THEN
      v_typed := NULLIF(btrim(r.meta->>'username'), '');
      IF v_typed IS NOT NULL
         AND char_length(v_typed) BETWEEN 3 AND 20
         AND NOT EXISTS (
           SELECT 1 FROM public.profiles WHERE username = v_typed
         ) THEN
        v_username := v_typed;
      ELSE
        v_username := public.fn_generate_profile_username(
          COALESCE(
            NULLIF(btrim(r.meta->>'full_name'), ''),
            NULLIF(btrim(r.meta->>'name'), ''),
            split_part(r.email, '@', 1)
          )
        );
      END IF;

      INSERT INTO public.profiles (id, username, avatar_url, is_verified_seller)
      VALUES (r.id, v_username, r.meta->>'avatar_url', false)
      ON CONFLICT (id) DO NOTHING;
    END IF;

    IF r.missing_private THEN
      INSERT INTO public.profiles_private (id, email, role, status)
      VALUES (r.id, r.email, 'user', 'active')
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END LOOP;
END
$backfill$;

COMMIT;
