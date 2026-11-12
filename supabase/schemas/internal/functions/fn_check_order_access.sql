CREATE OR REPLACE FUNCTION internal.fn_check_order_access (
  p_order_id uuid,
  p_user_id  uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
    RETURN EXISTS (
        -- Regla 1: El usuario es el comprador de la orden
        SELECT 1 FROM public.orders WHERE id = p_order_id AND buyer_id = p_user_id
        UNION ALL
        -- Regla 2: El usuario es vendedor de algún artículo en la orden
        SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND seller_id = p_user_id
        UNION ALL
        -- Regla 3: Override de Administrador (Verifica directo en profiles_private)
        SELECT 1 FROM public.profiles_private WHERE id = p_user_id AND role = 'admin'
    );
END; $function$;

GRANT EXECUTE ON FUNCTION "internal"."fn_check_order_access"(uuid, uuid) TO "authenticated", "service_role";

REVOKE ALL ON FUNCTION "internal"."fn_check_order_access"(uuid, uuid) FROM PUBLIC;
