
BEGIN
  -- Liberar productos que estaban apartados
  UPDATE public.products
  SET
    status = 'VERIFIED',
    updated_at = now(),
    reserved_at = NULL
  WHERE id = ANY(p_product_ids)
    AND status = 'RESERVED';

  RETURN QUERY SELECT true;
END;
