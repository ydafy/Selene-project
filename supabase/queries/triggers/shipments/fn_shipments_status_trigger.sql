
BEGIN
  -- Actualiza el estado de la orden global reactivamente tras cada cambio en shipments
  UPDATE public.orders
  SET status = public.fn_derive_order_status(NEW.order_id),
      updated_at = now()
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
