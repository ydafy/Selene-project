-- Source body for public.fn_generate_profile_username(p_raw text).
-- Migration: supabase/migrations/*_auth_username_provisioning.sql
-- Normalizes a raw name to the profile editor charset (letters, digits,
-- underscore, dot), clamps it to 3..20 characters and appends a random numeric
-- suffix until the username is free, giving up after 50 attempts.
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
