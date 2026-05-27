
BEGIN
  UPDATE public.profiles
  SET email = NEW.email,
      last_sign_in_at = NEW.last_sign_in_at
  WHERE id = NEW.id;

  -- Auditoría si falta el perfil (Sugerencia IA Local)
  IF NOT FOUND THEN
    RAISE WARNING 'Intento de actualizar perfil inexistente para usuario %', NEW.id;
  END IF;

  RETURN NEW;
END;
