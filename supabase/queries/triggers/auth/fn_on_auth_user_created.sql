-- Source body for public.fn_on_auth_user_created().
-- Migration: supabase/migrations/*_auth_username_provisioning.sql
-- Provisions profiles, profiles_private and wallets for every new auth user.
-- A typed registration username is validated and rejected when invalid or
-- taken; a derived one (full_name, name, email prefix) is normalized and
-- suffixed by public.fn_generate_profile_username so provisioning never fails.
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
