
BEGIN
  -- A. Crear perfil público (solo datos visibles)
  INSERT INTO public.profiles (
    id, username, avatar_url, is_verified_seller
  )
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  -- B. Crear perfil privado (email, role, status — Zero Trust)
  INSERT INTO public.profiles_private (
    id, email, role, status
  )
  VALUES (
    NEW.id,
    NEW.email,
    'user',
    'active'
  )
  ON CONFLICT (id) DO NOTHING;

  -- C. Crear Wallet
  INSERT INTO public.wallets (user_id, available_balance, pending_balance)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FALLO CRÍTICO EN SETUP DE USUARIO: %', SQLERRM;
END;
