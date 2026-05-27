
BEGIN
  -- Solo contamos las tarjetas activas (donde deleted_at es nulo)
  IF (SELECT COUNT(*) FROM public.payment_methods WHERE user_id = NEW.user_id AND deleted_at IS NULL) >= 3 THEN
    RAISE EXCEPTION 'PAYMENT_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
