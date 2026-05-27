
BEGIN
  -- A. Crear Perfil con valores por defecto
  INSERT INTO public.profiles (
    id, username, avatar_url, email, role, status, is_verified_seller
  )
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email,
    'user',
    'active',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  -- B. Crear Wallet
  INSERT INTO public.wallets (user_id, available_balance, pending_balance)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- BLOQUE CRÍTICO: Si falla, revertimos el registro en Auth para evitar usuarios huérfanos
  RAISE EXCEPTION 'FALLO CRÍTICO EN SETUP DE USUARIO: %', SQLERRM;
END;
