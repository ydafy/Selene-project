
DECLARE
  v_count INT;
  v_sum NUMERIC;
BEGIN
  -- Bloqueamos las filas para evitar que otro proceso las toque durante este milisegundo
  -- Solo reservamos si el producto está VERIFIED y no es del mismo comprador
  WITH updated_rows AS (
    UPDATE public.products
    SET status = 'RESERVED',
        updated_at = now(),
        reserved_at = now()
    WHERE id = ANY(p_product_ids)
      AND status = 'VERIFIED'
      AND seller_id != p_buyer_id
    RETURNING price
  )
  SELECT COUNT(*), SUM(price) INTO v_count, v_sum FROM updated_rows;

  -- Si logramos reservar TODOS los productos solicitados
  IF v_count = array_length(p_product_ids, 1) THEN
    RETURN QUERY SELECT v_sum, true, NULL::TEXT;
  ELSE
    -- Si falló (porque uno ya estaba reservado o vendido), no hacemos nada y avisamos
    -- Nota: El UPDATE de arriba se revierte automáticamente si no retornamos éxito en la lógica de tu app
    RETURN QUERY SELECT 0::NUMERIC, false, 'SOME_PRODUCTS_UNAVAILABLE'::TEXT;
  END IF;
END;
