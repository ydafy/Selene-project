CREATE OR REPLACE FUNCTION public.fn_reserve_products (
  p_buyer_id    uuid,
  p_product_ids uuid[]
)
  RETURNS TABLE (
    total_price   numeric,
    success       boolean,
    error_message text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
DECLARE
  v_count INT;
  v_sum NUMERIC;
  v_reserved_ids UUID[];
BEGIN
  -- 0. DEFENSA: Carrito nulo o vacío (retorno inmediato en 0ms)
  IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
    RETURN QUERY SELECT 0::NUMERIC, false, 'EMPTY_CART'::TEXT;
    RETURN;
  END IF;

  -- Banned buyers cannot purchase; suspended buyers keep their own purchases
  IF EXISTS (
    SELECT 1 FROM public.profiles_private pp
    WHERE pp.id = p_buyer_id AND pp.status = 'banned'
  ) THEN
    RETURN QUERY SELECT 0::NUMERIC, false, 'ACCOUNT_RESTRICTED'::TEXT;
    RETURN;
  END IF;

  -- 1. LIMPIEZA IDEMPOTENTE: Recuperar reservas vencidas (> 10 min) de este carrito
  PERFORM public.fn_release_listings(p_product_ids, true, true);

  -- 2. SEGURO ANTI-DEADLOCK: Bloqueo determinístico en orden alfabético de UUID
  PERFORM 1
  FROM public.products
  WHERE id = ANY(p_product_ids)
  ORDER BY id
  FOR UPDATE;

  -- 3. RESERVA ATÓMICA: Solo productos VERIFIED que no sean del comprador
  --    ni de vendedores suspendidos o baneados
  WITH reserved AS (
    UPDATE public.products
    SET status = 'RESERVED',
        updated_at = now(),
        reserved_at = now()
    WHERE id = ANY(p_product_ids)
      AND status = 'VERIFIED'
      AND seller_id <> p_buyer_id
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles_private pp
        WHERE pp.id = products.seller_id
          AND pp.status IN ('suspended', 'banned')
      )
    RETURNING id, price
  )
  SELECT array_agg(id), COUNT(*), COALESCE(SUM(price), 0)
    INTO v_reserved_ids, v_count, v_sum
  FROM reserved;

  -- 4. ALL-OR-NOTHING: Si no se reservó el 100% del carrito, revertir lo parcial
  IF v_count = cardinality(p_product_ids) THEN
    RETURN QUERY SELECT v_sum, true, NULL::TEXT;
  ELSE
    IF v_count > 0 THEN
      PERFORM public.fn_release_listings(v_reserved_ids, true, false);
    END IF;
    RETURN QUERY SELECT 0::NUMERIC, false, 'SOME_PRODUCTS_UNAVAILABLE'::TEXT;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_reserve_products"(uuid, uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_reserve_products"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_reserve_products"(uuid, uuid[]) TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_reserve_products"(uuid, uuid[]) FROM PUBLIC, "anon", "authenticated";
